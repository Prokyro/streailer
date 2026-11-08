const assert = require('assert');
const childProcess = require('child_process');
const originalExecFile = childProcess.execFile;
const { ids, dubbed, subtitled, reset, playerHtml } = require('./fixtures/trailer-fetch');

// Install a deterministic yt-dlp stub before requiring the provider.
const heights = new Map();
const invocations = [];
let failProbes = false;
childProcess.execFile = (command, args, options, callback) => {
    assert.strictEqual(command, 'yt-dlp');
    assert.ok(args.includes('--skip-download'));
    const url = new URL(args[args.length - 1]);
    const id = url.searchParams.get('v');
    invocations.push(id);
    setImmediate(() => {
        if (failProbes) return callback(new Error('YouTube unavailable'), '', '');
        const height = heights.get(id) ?? 720;
        callback(null, JSON.stringify({ formats: [
            { height, vcodec: 'vp09' }, { height: 360, vcodec: 'avc1' }
        ] }), '');
    });
    return { kill() {} };
};
const { getTrailerStreams } = require('../trailerProvider');
const { clearQualityCache } = require('../trailerQuality');

const VIDEO_4K = 'fourk000001';
const tmdb = (id, name = 'Primetime (2026) Trailer Dublado') => ({
    site: 'YouTube', type: 'Trailer', official: true, key: id, name,
    iso_639_1: 'pt', iso_3166_1: 'BR'
});
const get = (preferredQuality = 'auto') =>
    getTrailerStreams('movie', 'tt34206385', 'Primetime', undefined, 123,
        'pt-BR', false, 'internal', true, '', preferredQuality);

let passed = 0;
async function test(name, setup, check) {
    reset();
    clearQualityCache();
    heights.clear();
    invocations.length = 0;
    failProbes = false;
    setup();
    await check();
    console.log('PASS quality provider: ' + name);
    passed++;
}

async function run() {
    try {
        await test('default auto remains unchanged and runs no yt-dlp',
            () => reset({ localized: [tmdb(ids.dubbed), tmdb(VIDEO_4K)] }),
            async () => {
                const result = await get();
                assert.strictEqual(result[0].ytId, ids.dubbed);
                assert.strictEqual(invocations.length, 0);
            });
        await test('4K chooses the 2160p upload over 1080p with equal language',
            () => {
                heights.set(ids.dubbed, 1080);
                heights.set(VIDEO_4K, 2160);
                reset({ localized: [tmdb(ids.dubbed), tmdb(VIDEO_4K)] });
            },
            async () => {
                const result = await get('2160');
                assert.strictEqual(result[0].ytId, VIDEO_4K);
                assert.ok(result[0].name.includes('4K'));
            });
        await test('1080p selects the closest upload meeting its preference',
            () => {
                heights.set(ids.dubbed, 1080);
                heights.set(VIDEO_4K, 2160);
                reset({ localized: [tmdb(VIDEO_4K), tmdb(ids.dubbed)] });
            },
            async () => {
                const result = await get('1080');
                assert.strictEqual(result[0].ytId, ids.dubbed);
                assert.ok(result[0].name.includes('1080p'));
            });
        await test('PT-BR dubbed 1080p outranks subtitled 4K',
            () => {
                heights.set(ids.dubbed, 1080);
                heights.set(ids.subtitled, 2160);
                reset({ localized: [
                    tmdb(ids.subtitled, 'Primetime (2026) Trailer Legendado PT-BR'),
                    tmdb(ids.dubbed)
                ] });
            },
            async () => assert.strictEqual((await get('2160'))[0].ytId, ids.dubbed));
        await test('blocked 4K trailer falls back to available 1080p',
            () => {
                heights.set(ids.dubbed, 1080);
                heights.set(VIDEO_4K, 2160);
                reset({ localized: [tmdb(VIDEO_4K), tmdb(ids.dubbed)],
                    watch: { [VIDEO_4K]: playerHtml(['DE']) } });
            },
            async () => assert.strictEqual((await get('2160'))[0].ytId, ids.dubbed));
        await test('yt-dlp errors fall back instead of returning no trailers',
            () => {
                failProbes = true;
                reset({ localized: [tmdb(ids.dubbed), tmdb(VIDEO_4K)] });
            },
            async () => {
                const result = await get('2160');
                assert.strictEqual(result[0].ytId, ids.dubbed);
                assert.ok(!result[0].name.includes('4K'));
            });
        await test('4K YouTube upgrade replaces a lower-quality TMDB upload',
            () => {
                heights.set(ids.dubbed, 1080);
                heights.set(VIDEO_4K, 2160);
                reset({ localized: [tmdb(ids.dubbed)], candidates: [
                    { ytId: VIDEO_4K, title: 'Primetime (2026) Trailer Dublado 4K',
                        durationSeconds: 140 }
                ] });
            },
            async () => assert.strictEqual((await get('2160'))[0].ytId, VIDEO_4K));
        await test('4K subtitles cannot displace an available dubbed TMDB trailer',
            () => {
                heights.set(ids.dubbed, 1080);
                heights.set(ids.subtitled, 2160);
                reset({ localized: [tmdb(ids.dubbed)], candidates: [subtitled] });
            },
            async () => assert.strictEqual((await get('2160'))[0].ytId, ids.dubbed));
        console.log(passed + ' quality provider integration tests passed');
    } finally {
        childProcess.execFile = originalExecFile;
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
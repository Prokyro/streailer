const assert = require('assert');
const childProcess = require('child_process');
const originalExecFile = childProcess.execFile;
const calls = [];
childProcess.execFile = (binary, args, options, callback) => {
    calls.push({ binary, args, options });
    // The mock simulates yt-dlp JSON metadata without accessing YouTube.
    setImmediate(() => callback(null, JSON.stringify({
        formats: [
            { height: 1080, vcodec: 'avc1.640028' },
            { height: 2160, vcodec: 'vp09.00.51' },
            { height: 160, vcodec: 'none' },
            { height: 9999, vcodec: 'none', format_note: 'storyboard' }
        ]
    }), ''));
    return { kill() {} };
};
const {
    normalizePreferredQuality, maxVideoHeight, inspectYouTubeQuality,
    choosePreferredCandidate
} = require('../trailerQuality');

async function run() {
    try {
        assert.strictEqual(normalizePreferredQuality(undefined), 'auto');
        assert.strictEqual(normalizePreferredQuality('2160'), '2160');
        assert.strictEqual(normalizePreferredQuality('1080'), '1080');
        assert.strictEqual(normalizePreferredQuality('720'), '720');
        assert.strictEqual(normalizePreferredQuality('9999'), 'auto');

        assert.strictEqual(maxVideoHeight({ formats: [
            { height: 2160, vcodec: 'av01' },
            { height: 4320, vcodec: 'none' },
            { height: 2000, vcodec: 'av01', format_note: 'storyboard' }
        ] }), 2160);
        assert.strictEqual(maxVideoHeight({ formats: [{ height: 720, vcodec: 'none' }] }), null);

        const dubbed4k = { ytId: '12345678901', score: 4, qualityHeight: 2160 };
        const dubbedFhd = { ytId: '12345678902', score: 4, qualityHeight: 1080 };
        const subtitled4k = { ytId: '12345678903', score: 2, qualityHeight: 2160 };
        const unknown4k = { ytId: '12345678904', score: 0, qualityHeight: 2160 };
        assert.strictEqual(choosePreferredCandidate([dubbedFhd, dubbed4k], '2160'), dubbed4k);
        assert.strictEqual(choosePreferredCandidate([dubbed4k, dubbedFhd], '1080'), dubbedFhd);
        assert.strictEqual(choosePreferredCandidate([subtitled4k, dubbedFhd], '2160'), dubbedFhd);
        assert.strictEqual(choosePreferredCandidate([dubbedFhd, unknown4k], '2160'), dubbedFhd);
        // Spoken-language metadata bonuses may strengthen a score but must not
        // silently reclassify a subtitle-marked video as dubbed.
        const boostedSubtitled4k = { score: 8, languageScore: 2, qualityHeight: 2160 };
        assert.strictEqual(
            choosePreferredCandidate([boostedSubtitled4k, dubbedFhd], '2160'),
            dubbedFhd,
        );
        const verifiedSpokenPtBr = {
            score: 6, languageScore: 0, spokenAudioConfirmed: true,
            qualityHeight: 1080
        };
        assert.strictEqual(
            choosePreferredCandidate([subtitled4k, verifiedSpokenPtBr], '2160'),
            verifiedSpokenPtBr,
        );
        assert.strictEqual(choosePreferredCandidate([dubbedFhd, dubbed4k], 'auto'), dubbedFhd);

        assert.strictEqual(await inspectYouTubeQuality('not-an-id'), null);
        const [first, second] = await Promise.all([
            inspectYouTubeQuality('12345678901'),
            inspectYouTubeQuality('12345678901')
        ]);
        assert.strictEqual(first, 2160);
        assert.strictEqual(second, 2160);
        assert.strictEqual(await inspectYouTubeQuality('12345678901'), 2160);
        assert.strictEqual(calls.length, 1, 'in-flight and cached checks should reuse metadata');
        assert.strictEqual(calls[0].binary, 'yt-dlp');
        assert.ok(calls[0].args.includes('--skip-download'), 'metadata-only mode must not download');
        assert.ok(calls[0].args.includes('--dump-single-json'));
        assert.ok(!calls[0].args.includes('--output'));
        assert.strictEqual(calls[0].args[calls[0].args.length - 1], 'https://www.youtube.com/watch?v=12345678901');
        console.log('PASS quality: selection, caching, format verification and no-download mode');
    } finally {
        childProcess.execFile = originalExecFile;
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
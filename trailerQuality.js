/**
 * Inspect a YouTube upload's available video resolutions without downloading it.
 * Preferred quality selects the upload; playback quality remains player-controlled.
 */
const { execFile } = require('child_process');

const QUALITY_HEIGHTS = Object.freeze({ auto: 0, '2160': 2160, '1080': 1080, '720': 720 });
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const ERROR_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE = 500;
const cache = new Map();
const inflight = new Map();
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

function normalizePreferredQuality(value) {
    const key = String(value || 'auto');
    return Object.prototype.hasOwnProperty.call(QUALITY_HEIGHTS, key) ? key : 'auto';
}

function maxVideoHeight(data) {
    if (!data || !Array.isArray(data.formats)) return null;
    const heights = data.formats.filter(format =>
        format && format.vcodec && format.vcodec !== 'none' &&
        typeof format.height === 'number' && Number.isFinite(format.height) &&
        format.height >= 144 && format.height <= 4320 &&
        !/storyboard|thumbnail/i.test(String(format.format_note || ''))
    ).map(format => format.height);
    return heights.length ? Math.max(...heights) : null;
}

function inspectYouTubeQuality(ytId) {
    if (!VIDEO_ID.test(ytId || '')) return Promise.resolve(null);
    const existing = cache.get(ytId);
    if (existing && existing.expiresAt > Date.now()) return Promise.resolve(existing.height);
    if (inflight.has(ytId)) return inflight.get(ytId);

    const url = 'https://www.youtube.com/watch?v=' + ytId;
    const pending = new Promise(resolve => {
        execFile('yt-dlp', [
            '--ignore-config', '--no-playlist', '--skip-download',
            '--dump-single-json', '--no-warnings', '--socket-timeout', '5',
            '--', url
        ], { timeout: 8500, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
            if (error) return resolve(null);
            try { resolve(maxVideoHeight(JSON.parse(stdout))); }
            catch (_) { resolve(null); }
        });
    }).catch(() => null).then(height => {
        cache.delete(ytId);
        cache.set(ytId, {
            height,
            expiresAt: Date.now() + (height === null ? ERROR_TTL_MS : SUCCESS_TTL_MS)
        });
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
        inflight.delete(ytId);
        return height;
    });
    inflight.set(ytId, pending);
    return pending;
}

function languageTier(candidate) {
    // Respect the existing language scoring: dubbed > localized > subtitled >
    // unknown. API bonuses can increase score without changing this ordering.
    const score = Number(candidate.score) || 0;
    if (score >= 4) return 4;
    if (score >= 3) return 3;
    if (score >= 2) return 2;
    if (score >= 1) return 1;
    return 0;
}

function choosePreferredCandidate(candidates, preference) {
    if (!candidates.length) return null;
    const target = QUALITY_HEIGHTS[normalizePreferredQuality(preference)];
    if (!target) return candidates[0];
    const ranked = candidates.map((candidate, index) => ({ candidate, index }));
    ranked.sort((a, b) => {
        const locale = languageTier(b.candidate) - languageTier(a.candidate);
        if (locale) return locale;
        const ah = a.candidate.qualityHeight || 0;
        const bh = b.candidate.qualityHeight || 0;
        // Prefer known videos meeting the target, then the best lower quality.
        const am = ah >= target ? 1 : 0;
        const bm = bh >= target ? 1 : 0;
        if (am !== bm) return bm - am;
        if (am) return ah - bh; // Closest to the requested resolution.
        if (ah !== bh) return bh - ah;
        return a.index - b.index;
    });
    return ranked[0].candidate;
}

module.exports = {
    normalizePreferredQuality, maxVideoHeight,
    inspectYouTubeQuality, choosePreferredCandidate, languageTier
};

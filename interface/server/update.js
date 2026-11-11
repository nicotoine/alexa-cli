// Whether a newer APK is out. Every push to main publishes a GitHub release v<major>.<minor>.<build> with the APK
// under a fixed name (.github/workflows/ci.yml), so the latest release says the newest version and where to get it.
//
// Asked by the server, not the page: the page's Content-Security-Policy only lets it talk to its own server. Only a
// built copy asks (the APK, or a build made by scripts/build-apk.sh): a checkout run from source has no build number
// to compare and is updated with git.

import { versionInfo } from '../../src/version.js';

export const REPO = 'nicotoine/alexa-cli';
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/alexa-cli-universal.apk`;
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
// GitHub allows 60 unauthenticated calls an hour per address: one an hour is plenty for a release a day.
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10000;

const parts = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);

/** a > b, comparing <major>.<minor>.<build> number by number. */
export function isNewer(a, b) {
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
}

export function createUpdateCheck({ fetchFn = globalThis.fetch, current = versionInfo, now = Date.now } = {}) {
    let cached = null;
    return async function check() {
        const mine = current();
        if (!mine.build) return { checked: false, current: mine.version, reason: 'not a built copy' };
        if (cached && now() - cached.at < CACHE_MS) return { ...cached.answer, current: mine.version, newer: isNewer(cached.answer.latest, mine.version) };
        const res = await fetchFn(LATEST, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'alexa-cli' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const release = await res.json();
        const answer = {
            checked: true,
            latest: String(release.tag_name || '').replace(/^v/, ''),
            publishedAt: release.published_at || null,
            url: APK_URL,
            page: release.html_url || `https://github.com/${REPO}/releases/latest`,
        };
        cached = { at: now(), answer };
        return { ...answer, current: mine.version, newer: isNewer(answer.latest, mine.version) };
    };
}

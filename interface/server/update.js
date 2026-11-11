// Whether a newer APK is out. Every push to main publishes a GitHub release v<major>.<minor>.<build> with the APK
// under a fixed name (.github/workflows/ci.yml), so the latest release says the newest version and where to get it.
//
// Asked by the server, not the page: the page's Content-Security-Policy only lets it talk to its own server. Only a
// built copy asks (the APK, or a build made by scripts/build-apk.sh): a checkout run from source has no build number
// to compare and is updated with git.
//
// In the app, the server also downloads the new APK itself (createDownloader): the one for this phone's processor,
// checked against the release's SHA256SUMS, into the app's private storage, where the app's native side
// (MainActivity) hands it to Android's installer.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { versionInfo } from '../../src/version.js';

export const REPO = 'nicotoine/alexa-cli';
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/alexa-cli-universal.apk`;
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
// GitHub allows 60 unauthenticated calls an hour per address. On its own the app asks every 15 min at most (an hour
// was too long: the app stays alive in the background, and a release just published went unseen). Asked from the
// page's button it asks at once, but not more than every 30 s.
const CACHE_MS = 15 * 60 * 1000;
const FORCED_MIN_MS = 30 * 1000;
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
    return async function check({ force = false } = {}) {
        const mine = current();
        if (!mine.build) return { checked: false, current: mine.version, reason: 'not a built copy' };
        const fresh = cached && now() - cached.at < (force ? FORCED_MIN_MS : CACHE_MS);
        if (fresh) return { ...cached.answer, current: mine.version, newer: isNewer(cached.answer.latest, mine.version) };
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

// ---- downloading the APK, in the app

// The file MainActivity installs: a fixed name, so the page never says which file to install.
export const APK_FILE = 'alexa-cli-update.apk';
// process.arch in the app's Node.js → the APK built for that processor (scripts/build-apk.sh names them so).
const ABIS = { arm64: 'arm64-v8a', arm: 'armeabi-v7a', x64: 'x86_64' };

export function apkName(arch = process.arch) {
    return `alexa-cli-${ABIS[arch] || 'universal'}.apk`;
}

/** The hash SHA256SUMS gives for `name` ("<hex>  <name>" per line), or null. */
export function sumOf(sums, name) {
    for (const line of String(sums).split('\n')) {
        const [hash, file] = line.trim().split(/\s+/);
        if (file === name && /^[0-9a-f]{64}$/.test(hash)) return hash;
    }
    return null;
}

/**
 * Downloads one release's APK into `dir`, one download at a time; `progress()` says where it is. The file is written
 * under a temporary name and only takes the name MainActivity installs once its SHA-256 matches the release's.
 */
export function createDownloader({ dir, fetchFn = globalThis.fetch, arch = process.arch }) {
    let progress = { state: 'idle' };
    // An APK left from an earlier download is either installed by now or abandoned: 55 MB not worth keeping.
    for (const leftover of [APK_FILE, `${APK_FILE}.part`]) fs.rmSync(path.join(dir, leftover), { force: true });
    const base = (version) => `https://github.com/${REPO}/releases/download/v${version}`;

    async function run(version) {
        const name = apkName(arch);
        const sumsRes = await fetchFn(`${base(version)}/SHA256SUMS`, { headers: { 'User-Agent': 'alexa-cli' } });
        if (!sumsRes.ok) throw new Error(`SHA256SUMS: GitHub answered ${sumsRes.status}`);
        const expected = sumOf(await sumsRes.text(), name);
        if (!expected) throw new Error(`the release has no checksum for ${name}`);

        const res = await fetchFn(`${base(version)}/${name}`, { headers: { 'User-Agent': 'alexa-cli' } });
        if (!res.ok || !res.body) throw new Error(`${name}: GitHub answered ${res.status}`);
        fs.mkdirSync(dir, { recursive: true });
        const partial = path.join(dir, `${APK_FILE}.part`);
        const out = fs.createWriteStream(partial);
        const hash = crypto.createHash('sha256');
        progress = { state: 'downloading', version, file: name, received: 0, total: Number(res.headers.get('content-length')) || null };
        try {
            for await (const chunk of res.body) {
                hash.update(chunk);
                if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
                progress = { ...progress, received: progress.received + chunk.length };
            }
        } finally {
            await new Promise((r) => out.end(r));
        }
        progress = { ...progress, state: 'verifying' };
        if (hash.digest('hex') !== expected) {
            fs.rmSync(partial, { force: true });
            throw new Error('the downloaded APK does not match the release checksum');
        }
        fs.renameSync(partial, path.join(dir, APK_FILE));
        progress = { ...progress, state: 'ready' };
    }

    return {
        progress: () => progress,
        /** Starts downloading `version` unless a download is under way or it is already there; answers the progress. */
        start(version) {
            if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error('invalid version');
            const busy = progress.state === 'downloading' || progress.state === 'verifying';
            const done = progress.state === 'ready' && progress.version === version && fs.existsSync(path.join(dir, APK_FILE));
            if (!busy && !done) {
                progress = { state: 'downloading', version, received: 0, total: null };
                run(version).catch((e) => {
                    fs.rmSync(path.join(dir, `${APK_FILE}.part`), { force: true });
                    progress = { state: 'error', version, error: e.message };
                });
            }
            return progress;
        },
    };
}

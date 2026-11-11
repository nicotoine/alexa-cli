// Updating from inside the app: the server downloads the APK for this processor and checks it against the release's
// checksums; the page follows the download and asks the native side to install. No network, no phone.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { downloadAndInstall, nativeInstaller } from '../app/src/lib/core/installer.js';
import { createApp } from '../server/app.js';
import { APK_FILE, apkName, createDownloader, sumOf } from '../server/update.js';

const APK = Buffer.from('not really an apk, but bytes all the same');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** GitHub as the downloader sees it: SHA256SUMS and the APK, in chunks. */
function github({ sum = sha(APK), calls = [] } = {}) {
    return async (url) => {
        calls.push(url);
        if (url.endsWith('/SHA256SUMS')) return { ok: true, status: 200, text: async () => `${sum}  alexa-cli-arm64-v8a.apk\n${'0'.repeat(64)}  alexa-cli-universal.apk\n` };
        return {
            ok: true, status: 200,
            headers: { get: (h) => (h === 'content-length' ? String(APK.length) : null) },
            body: (async function* chunks() { yield APK.subarray(0, 10); yield APK.subarray(10); })(),
        };
    };
}

const settled = async (d) => {
    for (let i = 0; i < 50 && ['downloading', 'verifying'].includes(d.progress().state); i++) await new Promise((r) => setTimeout(r, 5));
    return d.progress();
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cli-update-'));

describe('the downloader', () => {
    it('picks the APK built for this processor, and reads its checksum', () => {
        assert.equal(apkName('arm64'), 'alexa-cli-arm64-v8a.apk');
        assert.equal(apkName('arm'), 'alexa-cli-armeabi-v7a.apk');
        assert.equal(apkName('mips'), 'alexa-cli-universal.apk');
        assert.equal(sumOf(`${'a'.repeat(64)}  alexa-cli-arm64-v8a.apk`, 'alexa-cli-arm64-v8a.apk'), 'a'.repeat(64));
        assert.equal(sumOf('garbage  alexa-cli-arm64-v8a.apk', 'alexa-cli-arm64-v8a.apk'), null);
    });

    it('downloads the release asked for and keeps it only once the checksum matches', async () => {
        const dir = tmp();
        const calls = [];
        const d = createDownloader({ dir, fetchFn: github({ calls }), arch: 'arm64' });
        d.start('0.2.30');
        const p = await settled(d);
        assert.equal(p.state, 'ready', JSON.stringify(p));
        assert.equal(p.received, APK.length);
        assert.deepEqual(fs.readFileSync(path.join(dir, APK_FILE)), APK);
        assert.match(calls[1], /\/releases\/download\/v0\.2\.30\/alexa-cli-arm64-v8a\.apk$/);
        // Already there: asking again does not download it twice.
        d.start('0.2.30');
        assert.equal(calls.length, 2);
    });

    it('throws away an APK that does not match, and says so', async () => {
        const dir = tmp();
        const d = createDownloader({ dir, fetchFn: github({ sum: 'f'.repeat(64) }), arch: 'arm64' });
        d.start('0.2.30');
        const p = await settled(d);
        assert.equal(p.state, 'error');
        assert.match(p.error, /does not match the release checksum/);
        assert.deepEqual(fs.readdirSync(dir), []);
    });

    it('refuses a version that is not one, and clears a leftover APK when it starts', () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, APK_FILE), 'old');
        const d = createDownloader({ dir, fetchFn: github(), arch: 'arm64' });
        assert.deepEqual(fs.readdirSync(dir), []);
        assert.throws(() => d.start('../../etc'), /invalid version/);
    });
});

describe('the routes', () => {
    const HOST = '127.0.0.1';
    let newer = true;
    const started = [];
    const downloader = { progress: () => ({ state: 'idle' }), start: (v) => { started.push(v); return { state: 'downloading', version: v }; } };
    const publicDir = tmp();
    let server;
    let port;
    let withDl;
    let withoutDl;
    before(async () => {
        server = http.createServer((req, res) => (req.headers['x-no-dl'] ? withoutDl : withDl)(req, res));
        await new Promise((r) => server.listen(0, HOST, r));
        port = server.address().port;
        const checkUpdate = async () => ({ checked: true, newer, latest: '0.2.30', current: '0.2.22' });
        withDl = createApp({ runner: {}, publicDir, host: HOST, port, checkUpdate, downloader });
        withoutDl = createApp({ runner: {}, publicDir, host: HOST, port, checkUpdate, downloader: null });
    });
    after(() => server.close());

    const call = (p, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
        const req = http.request({ host: HOST, port, path: p, method, headers: { host: `${HOST}:${port}`, ...headers } }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
        });
        req.on('error', reject);
        if (method === 'POST') req.write('{}');
        req.end();
    });
    const trusted = { 'content-type': 'application/json', 'x-alexa-cli': '1' };

    it('says whether this copy can install by itself', async () => {
        assert.equal((await call('/api/update')).json().selfInstall, true);
        assert.equal((await call('/api/update', { headers: { 'x-no-dl': '1' } })).json().selfInstall, false);
    });

    it('downloads the version the check found, only when asked by the page and only when newer', async () => {
        assert.equal((await call('/api/update/download', { method: 'POST' })).status, 403);
        const r = await call('/api/update/download', { method: 'POST', headers: trusted });
        assert.equal(r.status, 202);
        assert.deepEqual(started, ['0.2.30']);
        newer = false;
        assert.equal((await call('/api/update/download', { method: 'POST', headers: trusted })).status, 409);
        newer = true;
        assert.equal((await call('/api/update/download', { headers: { 'x-no-dl': '1' } })).status, 404);
    });
});

describe('the page side', () => {
    function port(answers) {
        const sent = [];
        const p = {
            onmessage: null,
            postMessage(text) {
                sent.push(JSON.parse(text).action);
                const a = answers[JSON.parse(text).action];
                if (a !== undefined) setTimeout(() => p.onmessage && p.onmessage({ data: JSON.stringify(a) }), 0);
            },
        };
        return { p, sent };
    }

    it('finds no installer outside the app, and one inside', async () => {
        assert.equal(nativeInstaller({}), null);
        const { p, sent } = port({ canInstall: { allowed: 'yes' } });
        assert.deepEqual(await nativeInstaller({ alexaUpdater: p }).ask('canInstall'), { allowed: 'yes' });
        assert.deepEqual(sent, ['canInstall']);
    });

    it('gives up on an app that does not answer', async () => {
        const { p } = port({});
        assert.equal(await nativeInstaller({ alexaUpdater: p }, 10).ask('install'), null);
    });

    it('follows the download to the end, then opens the installer', async () => {
        const { p, sent } = port({ install: { status: 'started' } });
        const steps = [{ state: 'verifying' }, { state: 'ready' }];
        const seen = [];
        const outcome = await downloadAndInstall({
            installer: nativeInstaller({ alexaUpdater: p }),
            start: async () => ({ state: 'downloading', received: 0, total: 10 }),
            progress: async () => steps.shift(),
            onProgress: (x) => seen.push(x.state),
            wait: async () => {},
        });
        assert.equal(outcome, 'started');
        assert.deepEqual(seen, ['downloading', 'verifying', 'ready']);
        assert.deepEqual(sent, ['install']);
    });

    it('stops on a failed download without asking to install', async () => {
        const { p, sent } = port({ install: { status: 'started' } });
        await assert.rejects(downloadAndInstall({
            installer: nativeInstaller({ alexaUpdater: p }),
            start: async () => ({ state: 'error', error: 'the downloaded APK does not match the release checksum' }),
            progress: async () => ({}),
        }), /does not match/);
        assert.deepEqual(sent, []);
    });

    it('passes on that Android wants the permission first', async () => {
        const { p } = port({ install: { status: 'needs-permission' } });
        const outcome = await downloadAndInstall({
            installer: nativeInstaller({ alexaUpdater: p }), start: async () => ({ state: 'ready' }), progress: async () => ({}),
        });
        assert.equal(outcome, 'needs-permission');
    });
});

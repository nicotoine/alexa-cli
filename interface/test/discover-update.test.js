// Looking for new devices from the page, and the offer of a newer APK: the server side (route, whitelist, GitHub
// check) and the page side (action and queue), with no network.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createActions } from '../app/src/lib/core/actions.js';
import { createActivity } from '../app/src/lib/core/activity.js';
import { explain } from '../app/src/lib/core/explain.js';
import { createStore } from '../app/src/lib/core/store.js';
import { createApp } from '../server/app.js';
import { APK_URL, createUpdateCheck, isNewer } from '../server/update.js';
import { writeArgv } from '../server/writes.js';

const built = (version) => () => ({ version, build: Number(version.split('.')[2]), commit: 'abc' });
const github = (tag, calls = []) => async (url, init) => {
    calls.push([url, init]);
    return { ok: true, status: 200, json: async () => ({ tag_name: tag, published_at: '2026-11-11T10:00:00Z', html_url: 'https://github.com/x' }) };
};

describe('the update check', () => {
    it('compares versions number by number, not as text', () => {
        assert.equal(isNewer('0.2.19', '0.2.18'), true);
        assert.equal(isNewer('0.2.100', '0.2.99'), true);
        assert.equal(isNewer('v0.3.1', '0.2.40'), true);
        assert.equal(isNewer('0.2.18', '0.2.18'), false);
        assert.equal(isNewer('0.2.17', '0.2.18'), false);
    });

    it('offers the latest release with the fixed APK link when it is newer', async () => {
        const check = createUpdateCheck({ fetchFn: github('v0.2.20'), current: built('0.2.18') });
        const u = await check();
        assert.deepEqual([u.checked, u.newer, u.latest, u.current, u.url], [true, true, '0.2.20', '0.2.18', APK_URL]);
    });

    it('asks GitHub at most once an hour', async () => {
        const calls = [];
        let clock = 0;
        const check = createUpdateCheck({ fetchFn: github('v0.2.18', calls), current: built('0.2.18'), now: () => clock });
        assert.equal((await check()).newer, false);
        clock += 30 * 60 * 1000;
        await check();
        assert.equal(calls.length, 1);
        clock += 31 * 60 * 1000;
        await check();
        assert.equal(calls.length, 2);
    });

    it('does not ask at all from a copy run from source', async () => {
        const calls = [];
        const check = createUpdateCheck({ fetchFn: github('v9.9.9', calls), current: () => ({ version: '0.2.0', build: null }) });
        assert.equal((await check()).checked, false);
        assert.equal(calls.length, 0);
    });
});

describe('the server', () => {
    const HOST = '127.0.0.1';
    const runs = [];
    const runner = { async run(argv) { runs.push(argv); return { ok: true, code: 0, doc: { applied: true, plan: 'discover devices', found: [] } }; } };
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cli-public-'));
    const journalFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cli-journal-')), 'journal.jsonl');
    let server;
    let port;
    let failing = false;
    before(async () => {
        server = http.createServer((req, res) => app(req, res));
        await new Promise((r) => server.listen(0, HOST, r));
        port = server.address().port;
        app = createApp({
            runner, publicDir, host: HOST, port, journalOptions: { file: journalFile },
            checkUpdate: async () => { if (failing) throw new Error('offline'); return { checked: true, newer: true, latest: '0.2.20' }; },
        });
    });
    after(() => server.close());
    let app;

    const request = (p, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
        const req = http.request({ host: HOST, port, path: p, method, headers: { host: `${HOST}:${port}`, 'content-type': 'application/json', 'x-alexa-cli': '1' } }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });

    it('answers the update check, and an unreachable GitHub as "not checked"', async () => {
        assert.equal((await request('/api/update')).json().latest, '0.2.20');
        failing = true;
        const r = await request('/api/update');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json(), { checked: false, reason: 'offline', selfInstall: false });
        failing = false;
    });

    it('runs a discovery at once and journals it', async () => {
        const r = await request('/api/do/discover', { method: 'POST', body: '{}' });
        assert.equal(r.status, 200);
        assert.deepEqual(runs.at(-1), ['discover', '--json']);
        const entries = JSON.parse(fs.readFileSync(journalFile, 'utf8').trim().split('\n').at(-1));
        assert.equal(entries.command, 'discover');
    });
});

describe('the whitelist', () => {
    it('lets discover through with an optional wait, never with --apply', () => {
        assert.deepEqual(writeArgv('discover', { apply: true }), ['discover', '--json']);
        assert.deepEqual(writeArgv('discover', { wait: '30' }), ['discover', '--wait', '30', '--json']);
        assert.throws(() => writeArgv('discover', { wait: '--apply' }), /may not start with "-"/);
        assert.throws(() => writeArgv('discover', { force: true }), /unknown field force/);
    });
});

describe('the page action', () => {
    function setup(answer) {
        const store = createStore({ kinds: ['appliances'] });
        const activity = createActivity({ now: () => 0 });
        const sent = [];
        let release;
        const gate = new Promise((r) => { release = r; });
        let resyncs = 0;
        const actions = createActions({
            store, activity, explain, resync: () => { resyncs++; },
            change: async (command, body) => { sent.push([command, body]); await gate; return answer(); },
        });
        return { actions, activity, sent, release, resyncs: () => resyncs };
    }

    it('runs one search at a time, says what appeared and reloads', async () => {
        const t = setup(() => ({ found: [{ name: 'Lampe du bureau' }] }));
        const first = t.actions.discover();
        assert.equal(t.actions.isDiscovering(), true);
        await t.actions.discover();
        t.release();
        await first;
        assert.equal(t.sent.length, 1);
        assert.equal(t.actions.isDiscovering(), false);
        assert.equal(t.activity.items[0].state, 'done');
        assert.match(t.activity.items[0].detail, /Lampe du bureau/);
        assert.equal(t.resyncs(), 1);
    });

    it('says when nothing new appeared, without reloading', async () => {
        const t = setup(() => ({ found: [] }));
        t.release();
        await t.actions.discover();
        assert.equal(t.activity.items[0].detail, 'Aucun nouvel appareil');
        assert.equal(t.resyncs(), 0);
    });

    it('offers a retry when the CLI refused', async () => {
        const t = setup(() => { throw new Error('not logged in'); });
        t.release();
        await t.actions.discover();
        assert.equal(t.activity.items[0].state, 'failed');
        assert.equal(typeof t.activity.items[0].retry, 'function');
        assert.equal(t.actions.isDiscovering(), false);
    });
});

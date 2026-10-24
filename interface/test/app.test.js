// The server's routes and protections, against a stub runner (no CLI, no Amazon).

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

const journalFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cli-journal-')), 'journal.jsonl');

const HOST = '127.0.0.1';
// A stand-in for the built app: the server only needs files to serve.
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cli-public-'));
fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>t</title>');
const runs = [];
const runner = {
    async run(argv) {
        runs.push(argv);
        if (argv.includes('refused')) return { ok: false, code: 1, doc: { error: 'phrase already used by: x' }, error: 'phrase already used by: x' };
        return { ok: true, code: 0, doc: { applied: argv.includes('--apply'), plan: 'plan' } };
    },
    snapshot(onLine) {
        onLine('{"kind":"routines","data":[1]}');
        onLine('not json');
        onLine('{"kind":"error","data":{"kind":"skills","message":"slow"}}');
        return { done: Promise.resolve({ ok: true }), abort() {} };
    },
    async session() {
        return { stored: true, valid: false, loggingIn: false };
    },
    async login() {
        return { url: 'http://127.0.0.1:3456/' };
    },
};

let server;
let port;
before(async () => {
    server = http.createServer((req, res) => app(req, res));
    await new Promise((r) => server.listen(0, HOST, r));
    port = server.address().port;
    app = createApp({ runner, publicDir, host: HOST, port, journalOptions: { file: journalFile } });
});
after(() => server.close());
let app;

function request(path, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: HOST, port, path, method, headers: { host: `${HOST}:${port}`, ...headers } }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

const write = (command, payload, headers = { 'content-type': 'application/json', 'x-alexa-cli': '1' }) =>
    request(`/api/do/${command}`, { method: 'POST', headers, body: JSON.stringify(payload) });

describe('protections', () => {
    it('refuses another host name (DNS rebinding)', async () => {
        assert.equal((await request('/', { headers: { host: `evil.example:${port}` } })).status, 421);
    });

    it('refuses a write without the custom header', async () => {
        const r = await write('delete', { target: 'x' }, { 'content-type': 'application/json' });
        assert.equal(r.status, 403);
    });

    it('refuses a write that is not JSON', async () => {
        const r = await write('delete', { target: 'x' }, { 'content-type': 'text/plain', 'x-alexa-cli': '1' });
        assert.equal(r.status, 403);
    });

    it('refuses an unknown command or a value that reads as an option, before running anything', async () => {
        const before = runs.length;
        assert.equal((await write('login', {})).status, 400);
        assert.equal((await write('delete', { target: '--apply' })).status, 400);
        assert.equal(runs.length, before);
    });

    it('does not serve files outside the page', async () => {
        assert.equal((await request('/../server/app.js')).status, 404);
        assert.equal((await request('/%2e%2e/server/app.js')).status, 404);
    });

    it('sends a strict content security policy', async () => {
        const r = await request('/');
        assert.equal(r.status, 200);
        assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    });
});

describe('session and login', () => {
    it('says whether a session is accepted', async () => {
        assert.deepEqual(JSON.parse((await request('/api/session')).body), { stored: true, valid: false, loggingIn: false });
    });

    it('starts a login only with the custom header', async () => {
        const refused = await request('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(refused.status, 403);
        const started = await request('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-alexa-cli': '1' }, body: '{}' });
        assert.deepEqual(JSON.parse(started.body), { url: 'http://127.0.0.1:3456/' });
    });
});

describe('routes', () => {
    it('answers a change with the CLI document', async () => {
        const r = await write('delete', { target: 'x', apply: true });
        assert.equal(r.status, 200);
        assert.deepEqual(JSON.parse(r.body), { applied: true, plan: 'plan' });
        assert.deepEqual(runs.at(-1), ['delete', 'x', '--apply', '--json']);
    });

    it('journals applied changes, newest first, and not dry runs', async () => {
        await write('delete', { target: 'dry' });
        await write('disable', { target: 'r9', apply: true });
        const entries = JSON.parse((await request('/api/journal')).body);
        assert.equal(entries[0].command, 'disable');
        assert.equal(entries[0].target, 'r9');
        assert.equal(entries[0].ok, true);
        assert.ok(!entries.some((e) => e.target === 'dry'));
    });

    it('answers a refusal with 422 and the CLI message', async () => {
        const r = await write('delete', { target: 'refused', apply: true });
        assert.equal(r.status, 422);
        assert.match(JSON.parse(r.body).error, /phrase already used/);
    });

    it('streams the snapshot, skipping lines that are not JSON, then sends a cached copy first', async () => {
        const first = (await request('/api/snapshot')).body.trim().split('\n').map(JSON.parse);
        assert.deepEqual(first.map((l) => l.kind), ['routines', 'error']);
        const second = (await request('/api/snapshot')).body.trim().split('\n').map(JSON.parse);
        assert.deepEqual(second[0], { kind: 'routines', data: [1], cached: true });
        assert.equal(second.filter((l) => l.kind === 'error' && l.cached).length, 0, 'errors are never cached');
    });
});

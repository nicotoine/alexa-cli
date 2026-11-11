// A device's panel: reading its state through the server, switching it on or off from the page. No network.

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
import { stateArgv, writeArgv } from '../server/writes.js';

describe('the whitelist', () => {
    it('switches at once, never with --apply', () => {
        assert.deepEqual(writeArgv('control', { target: 'lamp', op: 'turnOn', apply: true }), ['control', 'lamp', '--op', 'turnOn', '--json']);
        assert.throws(() => writeArgv('control', { target: '--apply', op: 'turnOn' }), /may not start with "-"/);
    });

    it('reads a state for one device only', () => {
        assert.deepEqual(stateArgv('Lampe du bureau'), ['state', 'Lampe du bureau', '--json']);
        assert.throws(() => stateArgv(null), /invalid device/);
        assert.throws(() => stateArgv('--debug'), /may not start with "-"/);
    });
});

describe('GET /api/state', () => {
    const HOST = '127.0.0.1';
    const runs = [];
    const runner = {
        async run(argv) {
            runs.push(argv);
            if (argv[1] === 'missing') return { ok: false, code: 1, error: 'no device is named "missing"' };
            return { ok: true, code: 0, doc: { name: argv[1], power: 'ON', reachable: true, features: [] } };
        },
    };
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cli-public-'));
    let server;
    let port;
    let app;
    before(async () => {
        server = http.createServer((req, res) => app(req, res));
        await new Promise((r) => server.listen(0, HOST, r));
        port = server.address().port;
        app = createApp({ runner, publicDir, host: HOST, port, checkUpdate: async () => ({ checked: false }) });
    });
    after(() => server.close());

    const get = (p) => new Promise((resolve, reject) => {
        http.get({ host: HOST, port, path: p, headers: { host: `${HOST}:${port}` } }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
        }).on('error', reject);
    });

    it('answers the CLI document, with the id decoded', async () => {
        const r = await get(`/api/state?device=${encodeURIComponent('AAA_x#1')}`);
        assert.equal(r.status, 200);
        assert.equal(r.json().power, 'ON');
        assert.deepEqual(runs.at(-1), ['state', 'AAA_x#1', '--json']);
    });

    it('refuses a missing device before running anything, and passes the CLI refusal on', async () => {
        const before = runs.length;
        assert.equal((await get('/api/state')).status, 400);
        assert.equal(runs.length, before);
        const r = await get('/api/state?device=missing');
        assert.equal(r.status, 422);
        assert.match(r.json().error, /no device is named/);
    });
});

describe('the power action', () => {
    function setup(answer) {
        const activity = createActivity({ now: () => 0 });
        const sent = [];
        const actions = createActions({
            store: createStore({ kinds: ['appliances'] }), activity, explain,
            change: async (command, body) => { sent.push([command, body]); return answer(); },
        });
        return { actions, activity, sent };
    }
    const lamp = { applianceId: 'AAA_lamp', friendlyName: 'Lampe du bureau' };

    it('sends the operation and hands back the state the device reports', async () => {
        const t = setup(() => ({ state: { power: 'ON' } }));
        const after = await t.actions.power(lamp, true);
        assert.deepEqual(t.sent, [['control', { target: 'AAA_lamp', op: 'turnOn' }]]);
        assert.equal(after.power, 'ON');
        assert.deepEqual([t.activity.items[0].label, t.activity.items[0].detail], ['Allumer « Lampe du bureau »', 'Allumé']);
    });

    it('says why it failed, offers a retry and hands back nothing', async () => {
        const t = setup(() => { throw new Error('the device refused turnOff: ENDPOINT_UNREACHABLE'); });
        assert.equal(await t.actions.power(lamp, false), null);
        assert.equal(t.activity.items[0].state, 'failed');
        assert.equal(typeof t.activity.items[0].retry, 'function');
    });
});

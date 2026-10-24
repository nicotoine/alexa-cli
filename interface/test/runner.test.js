// The in-process runner the Android app uses: main() called directly, one Amazon connection kept between calls.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInProcessRunner } from '../server/cli-runner.js';
import { NotLoggedIn } from '../../src/client.js';
import { fakeClient } from '../../test/fixtures.js';

function counted(connect) {
    const calls = [];
    const fn = (options) => {
        calls.push(options);
        return connect(options);
    };
    return { fn, calls };
}

describe('in-process runner', () => {
    it('runs a command and answers its JSON document', async () => {
        const connect = counted(async () => fakeClient());
        const runner = createInProcessRunner({ connect: connect.fn });
        const result = await runner.run(['delete', 'réveil', '--json']);
        assert.equal(result.ok, true);
        assert.equal(result.doc.applied, false);
        assert.match(result.doc.plan, /delete "réveil"/);
    });

    it('connects once and reuses the connection', async () => {
        const connect = counted(async () => fakeClient());
        const runner = createInProcessRunner({ connect: connect.fn });
        await runner.run(['routines', '--json']);
        await runner.run(['audit', '--json']);
        assert.equal(connect.calls.length, 1);
    });

    it('streams the snapshot line by line', async () => {
        const runner = createInProcessRunner({ connect: async () => fakeClient() });
        const lines = [];
        const run = runner.snapshot((line) => lines.push(JSON.parse(line).kind));
        assert.equal((await run.done).ok, true);
        assert.deepEqual(lines.sort(), ['appliances', 'audit', 'devices', 'routines', 'skills']);
    });

    it('drops a refused connection, so the next call connects again', async () => {
        let attempt = 0;
        const connect = counted(async () => {
            attempt++;
            if (attempt === 1) throw new NotLoggedIn();
            return fakeClient();
        });
        const runner = createInProcessRunner({ connect: connect.fn });
        const first = await runner.run(['routines', '--json']);
        assert.equal(first.ok, false);
        assert.match(first.error, /alexa-cli login/);
        const second = await runner.run(['routines', '--json']);
        assert.equal(second.ok, true);
        assert.equal(connect.calls.length, 2);
    });

    it('logs in through the proxy and keeps the new connection', async () => {
        let finish;
        const client = fakeClient();
        const connect = counted((options) => {
            if (!options.interactive) return Promise.reject(new NotLoggedIn());
            return new Promise((resolve) => {
                options.onLoginUrl('http://127.0.0.1:3456/');
                finish = () => resolve(client);
            });
        });
        const runner = createInProcessRunner({ connect: connect.fn });
        assert.deepEqual(await runner.login(), { url: 'http://127.0.0.1:3456/' });
        assert.equal((await runner.session()).loggingIn, true);
        finish();
        await new Promise((r) => setImmediate(r));
        const result = await runner.run(['routines', '--json']);
        assert.equal(result.ok, true);
        assert.equal(connect.calls.filter((c) => c.interactive).length, 1);
        assert.equal(connect.calls.filter((c) => !c.interactive).length, 0, 'the login connection is the one reused');
    });
});

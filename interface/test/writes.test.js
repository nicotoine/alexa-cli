import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequest, writeArgv } from '../server/writes.js';

describe('writeArgv', () => {
    it('builds a dry run by default and an applied change on request, always as JSON', () => {
        assert.deepEqual(writeArgv('delete', { target: 'r1' }), ['delete', 'r1', '--json']);
        assert.deepEqual(writeArgv('delete', { target: 'r1', apply: true }), ['delete', 'r1', '--apply', '--json']);
    });

    it('repeats list options and passes flags', () => {
        assert.deepEqual(writeArgv('create', { phrase: ['a', 'b'], device: 'Télé', op: 'turnOff', apply: true }),
            ['create', '--phrase', 'a', '--phrase', 'b', '--device', 'Télé', '--op', 'turnOff', '--apply', '--json']);
        assert.deepEqual(writeArgv('forget', { target: 'x', force: true, apply: true }), ['forget', 'x', '--force', '--apply', '--json']);
    });

    it('passes a spec as JSON, object or string, with its own size limit', () => {
        const spec = { when: { say: ['-commence par un tiret'] }, do: [{ wait: 1 }] };
        assert.deepEqual(writeArgv('update', { target: 'r1', spec, apply: true }), ['update', 'r1', '--spec', JSON.stringify(spec), '--apply', '--json']);
        assert.throws(() => writeArgv('create', { spec: 'x'.repeat(33 * 1024) }), /spec too large/);
    });

    it('never adds --apply to run, which acts at once', () => {
        assert.deepEqual(writeArgv('run', { target: 'r1', apply: true }), ['run', 'r1', '--json']);
    });

    for (const [command, body, why] of [
        ['login', {}, /unknown command/],
        ['snapshot', {}, /unknown command/],
        ['delete', { target: '--apply' }, /may not start with "-"/],
        ['create', { phrase: ['-x'] }, /may not start with "-"/],
        ['delete', {}, /invalid target/],
        ['delete', { target: 'x'.repeat(301) }, /invalid target/],
        ['delete', { target: 'r', force: true }, /unknown field force/],
        ['forget', { target: 'r', force: 'yes' }, /invalid force/],
        ['phrases', { target: 'r', add: Array(31).fill('a') }, /too many add/],
    ]) {
        it(`refuses ${command} ${JSON.stringify(body).slice(0, 40)}`, () => {
            assert.throws(() => writeArgv(command, body), (e) => e instanceof BadRequest && why.test(e.message));
        });
    }
});

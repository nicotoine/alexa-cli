// The commands end to end, against a fake Alexa client: what each one prints, and what it would have sent.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotLoggedIn } from '../src/client.js';
import { fakeClient } from './fixtures.js';
import { cli } from './helpers.js';

const written = (client, kind) => client.calls.filter((c) => c[0] === kind);
const updatedBody = (client) => written(client, 'update')[0][1];

describe('reading', () => {
    it('lists routines one per line with --plain', async () => {
        const r = await cli(['routines', '--plain'], fakeClient());
        assert.equal(r.code, 0);
        const rows = r.stdout.trim().split('\n').map((l) => l.split('\t'));
        assert.deepEqual(rows.map((x) => x[1]), ['pause télé', 'on va dormir', 'réveil']);
        assert.equal(rows[0][2], 'pause télé | mets la télé en pause');
    });

    it('filters routines on their phrases', async () => {
        const r = await cli(['routines', 'bonne nuit', '--json'], fakeClient());
        assert.deepEqual(r.json().map((x) => x.name), ['on va dormir']);
    });

    it('audits broken routines as JSON', async () => {
        const r = await cli(['audit', '--json'], fakeClient());
        assert.deepEqual(r.json().map((x) => x.name), ['réveil']);
    });

    it('shows skills found through their devices', async () => {
        const r = await cli(['skills', '--json'], fakeClient());
        assert.deepEqual(r.json().map((s) => [s.name, s.devices.map((d) => d.name)]), [['TCL', ['Smart TV']], ['Radio France', []]]);
    });
});

describe('acting', () => {
    it('only says what it would do without --apply', async () => {
        const client = fakeClient();
        const r = await cli(['delete', 'réveil'], client);
        assert.equal(r.code, 0);
        assert.match(r.stdout, /delete "réveil"/);
        assert.match(r.stderr, /dry run/);
        assert.deepEqual(client.calls, []);
    });

    it('creates a routine whose phrases and device are the ones asked for', async () => {
        const client = fakeClient();
        const r = await cli(['create', '--phrase', 'lance Kodi', '--phrase', 'ouvre Kodi', '--device', 'Télé', '--apply', '--json'], client);
        assert.equal(r.code, 0, r.stdout);
        assert.equal(r.json().applied, true);
        const body = written(client, 'create')[0][1];
        assert.deepEqual(JSON.parse(JSON.parse(body.triggerJson).payload).utterances, ['lance Kodi', 'ouvre Kodi']);
        assert.equal(JSON.parse(body.sequenceJson).startNode.operationPayload.target, 'tv-ha');
        assert.equal(body.behaviorId, undefined);
    });

    it('refuses to create a phrase another routine answers to', async () => {
        const client = fakeClient();
        const r = await cli(['create', '--phrase', 'Pause télé', '--device', 'Télé', '--apply', '--json'], client);
        assert.equal(r.code, 1);
        assert.match(r.json().error, /already used by: pause télé/);
        assert.deepEqual(written(client, 'create'), []);
    });

    it('adds and removes phrases in place, keeping the routine id', async () => {
        const client = fakeClient();
        const r = await cli(['phrases', 'pause télé', '--add', 'pause la télé', '--remove', 'mets la télé en pause', '--apply'], client);
        assert.equal(r.code, 0, r.stderr);
        const body = updatedBody(client);
        assert.equal(body.behaviorId, 'amzn1.alexa.automation.pause');
        assert.deepEqual(JSON.parse(JSON.parse(body.triggerJson).payload).utterances, ['pause télé', 'pause la télé']);
    });

    it('will not leave a routine without a phrase', async () => {
        const r = await cli(['phrases', 'réveil', '--remove', 'réveil', '--apply'], fakeClient());
        assert.equal(r.code, 1);
        assert.match(r.stderr, /at least one phrase/);
    });

    it('retargets only the device named with --from, in a routine with several actions', async () => {
        const client = fakeClient();
        const r = await cli(['retarget', 'on va dormir', '--from', 'Smart TV', '--device', 'Télé', '--apply'], client);
        assert.equal(r.code, 0, r.stderr);
        const nodes = JSON.parse(updatedBody(client).sequenceJson).startNode.nodesToExecute;
        assert.deepEqual(nodes.map((n) => n.operationPayload.target || n.operationPayload.textToSpeak), ['tv-ha', 'virtual@LIGHT@ACUSTOMER0001', 'bonne nuit']);
    });

    it('disables a routine, and does nothing for one already in that state', async () => {
        const client = fakeClient();
        await cli(['disable', 'pause télé', '--apply'], client);
        assert.equal(updatedBody(client).status, 'DISABLED');
        const again = fakeClient();
        again.routineList[0].status = 'DISABLED';
        const r = await cli(['disable', 'pause télé', '--apply'], again);
        assert.match(r.stdout, /already DISABLED/);
        assert.deepEqual(written(again, 'update'), []);
    });

    it('refuses to forget a device a routine uses, unless forced', async () => {
        const client = fakeClient();
        const refused = await cli(['forget', 'Smart TV', '--apply', '--json'], client);
        assert.equal(refused.code, 1);
        assert.match(refused.json().error, /still used by 1 routine\(s\): on va dormir/);
        assert.deepEqual(written(client, 'forget'), []);
        const forced = await cli(['forget', 'Smart TV', '--force', '--apply', '--json'], client);
        assert.equal(forced.code, 0, forced.stdout);
        assert.deepEqual(forced.json().brokenRoutines, ['on va dormir']);
        assert.deepEqual(written(client, 'forget'), [['forget', 'SKILL_tcl_tv']]);
    });

    it('runs a routine on the first Echo', async () => {
        const client = fakeClient();
        const r = await cli(['run', 'pause télé'], client);
        assert.equal(r.code, 0);
        assert.deepEqual(written(client, 'run'), [['run', 'ECHO1', 'amzn1.alexa.automation.pause']]);
    });
});

describe('failures', () => {
    it('says how to log in when no session is stored', async () => {
        const r = await cli(['routines', '--json'], new NotLoggedIn());
        assert.equal(r.code, 1);
        assert.match(r.json().error, /alexa-cli login/);
    });

    it('exits 2 on an unknown command or option, with the error as JSON when asked', async () => {
        assert.equal((await cli(['nope'], fakeClient())).code, 2);
        const r = await cli(['routines', '--nope', '--json'], fakeClient());
        assert.equal(r.code, 2);
        assert.match(r.json().error, /unknown option/);
    });

    it('answers --help without connecting', async () => {
        const r = await cli(['create', '--help'], new Error('must not connect'));
        assert.equal(r.code, 0);
        assert.match(r.stdout, /--phrase TEXT/);
    });
});

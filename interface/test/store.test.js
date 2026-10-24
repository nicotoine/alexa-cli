// The optimistic engine and the activity queue: changes drawn at once, followed in the queue, undone or refused
// without disturbing one another.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createActions } from '../app/src/lib/actions.js';
import { createActivity } from '../app/src/lib/activity.js';
import { explain } from '../app/src/lib/explain.js';
import { createStore } from '../app/src/lib/store.js';

const routine = (id, status = 'ENABLED', phrases = [id]) => ({
    automationId: id, name: id, status,
    triggers: [{ type: 'CustomUtterance', payload: { utterance: phrases[0], utterances: phrases } }],
    sequence: { startNode: { '@type': 'OpaquePayloadOperationNode', operationPayload: { target: 'tv-tcl', operations: [{ type: 'turnOff' }] } } },
});

function setup({ fail = () => null } = {}) {
    let clock = 1000;
    const store = createStore({ kinds: ['routines', 'devices', 'appliances', 'audit', 'echos'], now: () => clock });
    store.receive('routines', [routine('a'), routine('b'), routine('c')]);
    store.receive('devices', [{ id: 'tv-ha', displayName: 'Télé' }, { id: 'tv-tcl', displayName: 'Smart TV' }]);
    store.receive('echos', [{ serialNumber: 'E1', accountName: 'Salon', deviceType: 'T1' }]);
    store.receive('audit', [{ automationId: 'c', name: 'c', missing: [] }]);
    const activity = createActivity({ now: () => clock });
    const sent = [];
    const timers = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const actions = createActions({
        store,
        activity,
        explain,
        change: async (command, body) => {
            sent.push([command, body]);
            await gate;
            const error = fail(command, body);
            if (error) throw new Error(error);
            return { applied: true };
        },
        schedule: (fn) => (timers.push(fn), timers.length),
        unschedule: () => {},
    });
    return { store, actions, activity, sent, timers, release, tick: (ms) => { clock += ms; } };
}

const statuses = (store) => store.view.routines.map((r) => `${r.automationId}:${r.status}`).join(' ');
const states = (activity) => activity.items.map((i) => i.state);

describe('optimistic changes', () => {
    it('draw at once, show as running, and stay drawn once Amazon confirms', async () => {
        const { store, actions, activity, release } = setup();
        const done = actions.setStatus(store.view.routines[0], 'DISABLED');
        assert.equal(statuses(store), 'a:DISABLED b:ENABLED c:ENABLED');
        assert.deepEqual(states(activity), ['running']);
        assert.equal(activity.summary().busy, true);
        release();
        await done;
        assert.deepEqual(states(activity), ['done']);
        assert.equal(activity.items[0].detail, 'Désactivée');
        assert.equal(statuses(store), 'a:DISABLED b:ENABLED c:ENABLED', 'still drawn until a newer snapshot');
    });

    it('go back to Amazon\'s state when refused, the queue saying why with a retry', async () => {
        const { store, actions, activity, release } = setup({ fail: () => 'phrase already used by: b' });
        const done = actions.editPhrases(store.view.routines[0], { add: ['b'] });
        assert.deepEqual(store.view.routines[0].triggers[0].payload.utterances, ['a', 'b']);
        release();
        await done;
        assert.deepEqual(store.view.routines[0].triggers[0].payload.utterances, ['a']);
        const [item] = activity.items;
        assert.equal(item.state, 'failed');
        assert.equal(item.detail, 'Phrase déjà utilisée par « b ».');
        assert.equal(typeof item.retry, 'function');
    });

    it('undo one change without disturbing another in flight', async () => {
        const { store, actions, activity, release, sent } = setup();
        const statusChange = actions.setStatus(store.view.routines[1], 'DISABLED');
        const deletion = actions.deleteRoutine(store.view.routines[0]);
        assert.equal(statuses(store), 'b:DISABLED c:ENABLED');
        assert.deepEqual(states(activity), ['running', 'waiting']);
        activity.items[1].undo();
        await deletion;
        assert.equal(statuses(store), 'a:ENABLED b:DISABLED c:ENABLED');
        assert.deepEqual(states(activity), ['running', 'cancelled']);
        release();
        await statusChange;
        assert.deepEqual(sent.map(([c]) => c), ['disable'], 'the undone deletion was never sent');
    });

    it('send a deletion only once the undo window is over', async () => {
        const { store, actions, activity, release, sent, timers } = setup();
        const deletion = actions.deleteRoutine(store.view.routines[2]);
        assert.equal(sent.length, 0);
        assert.ok(activity.items[0].deadline > Date.now(), 'the queue knows when it will be sent');
        assert.deepEqual(store.view.audit, [], 'the audit entry goes with it');
        timers[0]();
        assert.equal(activity.items[0].state, 'running');
        release();
        await deletion;
        assert.deepEqual(sent, [['delete', { target: 'c', apply: true }]]);
    });

    it('keep a confirmed change over a snapshot that started before it, and drop it after a newer one', async () => {
        const { store, actions, release, tick } = setup();
        const since = 1000;
        tick(10);
        const done = actions.setStatus(store.view.routines[0], 'DISABLED');
        release();
        await done;
        store.receive('routines', [routine('a'), routine('b'), routine('c')], { since });
        assert.equal(statuses(store).split(' ')[0], 'a:DISABLED', 'an older snapshot does not undo it');
        tick(10);
        store.receive('routines', [routine('a', 'DISABLED'), routine('b'), routine('c')], { since: 1100 });
        assert.equal(store.ops.size, 0);
    });

    it('never let a cached copy replace fresh data', () => {
        const { store } = setup();
        assert.equal(store.receive('routines', [], { cached: true }), false);
        assert.equal(store.view.routines.length, 3);
    });

    it('retarget only the chosen device', async () => {
        const { store, actions, release } = setup();
        store.receive('appliances', [{ applianceId: 'SKILL_tcl', entityId: 'tv-tcl', friendlyName: 'Smart TV' }]);
        const done = actions.retarget(store.view.routines[0], 'Smart TV', 'Télé');
        assert.equal(store.view.routines[0].sequence.startNode.operationPayload.target, 'tv-ha');
        release();
        await done;
    });

    it('offer to force a device deletion refused because routines use it', async () => {
        const { store, actions, activity, release, timers } = setup({ fail: (c, b) => (b.force ? null : 'still used by 1 routine(s): a (--force to delete anyway)') });
        store.receive('appliances', [{ applianceId: 'SKILL_tcl', entityId: 'tv-tcl', friendlyName: 'Smart TV' }]);
        const done = actions.forget(store.view.appliances[0]);
        timers[0]();
        release();
        await done;
        assert.equal(store.view.appliances.length, 1, 'back after the refusal');
        const [item] = activity.items;
        assert.equal(item.action.label, 'Forcer');
        assert.match(item.detail, /Encore utilisé par : a\./);
    });
});

describe('saving a routine from the editor', () => {
    const spec = { name: 'bonne nuit', when: { say: ['bonne nuit'] }, do: [{ device: 'Télé', turn: 'off' }, { say: 'dodo', on: 'Salon' }] };

    it('draws a new routine as a draft, built like the CLI builds it, and sends the spec', async () => {
        const { store, actions, release, sent } = setup();
        const done = actions.save(spec);
        const draft = store.view.routines.at(-1);
        assert.equal(draft.draft, true);
        assert.deepEqual(draft.sequence.startNode.nodesToExecute.map((n) => n.type), ['Alexa.SmartHome.Batch', 'Alexa.Speak']);
        release();
        await done;
        assert.deepEqual(sent, [['create', { spec, apply: true }]]);
    });

    it('replaces an existing routine in place', async () => {
        const { store, actions, release, sent } = setup();
        const done = actions.save(spec, store.view.routines[1]);
        assert.equal(store.view.routines[1].name, 'bonne nuit');
        assert.equal(store.view.routines[1].automationId, 'b');
        release();
        await done;
        assert.deepEqual(sent[0], ['update', { target: 'b', spec, apply: true }]);
    });

    it('fails at once, in the queue, on a device the account does not have', async () => {
        const { actions, activity, sent } = setup();
        await actions.save({ ...spec, do: [{ device: 'Nope', turn: 'on' }] });
        assert.equal(activity.items[0].state, 'failed');
        assert.equal(activity.items[0].detail, 'Aucun appareil ne s\'appelle « Nope ».');
        assert.deepEqual(sent, []);
    });
});

describe('activity queue', () => {
    it('keeps the latest finished items and every active one', () => {
        const activity = createActivity({ keep: 2 });
        const ids = [1, 2, 3, 4].map((n) => activity.add({ label: `job ${n}` }));
        ids.slice(0, 3).forEach((id) => activity.update(id, { state: 'done' }));
        assert.deepEqual(activity.items.map((i) => i.label), ['job 2', 'job 3', 'job 4']);
        assert.equal(activity.summary().running, 1);
        assert.equal(activity.summary().last.label, 'job 3');
        activity.clearFinished();
        assert.deepEqual(activity.items.map((i) => i.label), ['job 4']);
    });

    it('stamps when an item ends', () => {
        let t = 5;
        const activity = createActivity({ now: () => t });
        const id = activity.add({ label: 'x' });
        t = 9;
        activity.update(id, { state: 'failed', detail: 'boom' });
        assert.deepEqual([activity.items[0].startedAt, activity.items[0].endedAt], [5, 9]);
    });
});

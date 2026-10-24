// The optimistic engine: changes drawn at once, undone or refused without disturbing one another.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createActions } from '../public/js/actions.js';
import { createStore } from '../public/js/store.js';
import { explain } from '../public/js/toasts.js';

const routine = (id, status = 'ENABLED', phrases = [id]) => ({
    automationId: id, name: id, status,
    triggers: [{ type: 'CustomUtterance', payload: { utterance: phrases[0], utterances: phrases } }],
    sequence: { startNode: { '@type': 'OpaquePayloadOperationNode', operationPayload: { target: 'tv-tcl', operations: [{ type: 'turnOff' }] } } },
});

function setup({ fail = () => null } = {}) {
    let clock = 1000;
    const store = createStore({ kinds: ['routines', 'devices', 'appliances', 'audit'], now: () => clock });
    store.receive('routines', [routine('a'), routine('b'), routine('c')]);
    store.receive('devices', [{ id: 'tv-ha', displayName: 'Télé' }, { id: 'tv-tcl', displayName: 'Smart TV' }]);
    store.receive('audit', [{ automationId: 'c', name: 'c', missing: [] }]);
    const sent = [];
    const toasts = [];
    const timers = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const actions = createActions({
        store,
        explain,
        change: async (command, body) => {
            sent.push([command, body]);
            await gate;
            const error = fail(command, body);
            if (error) throw new Error(error);
            return { applied: true };
        },
        toast: (message, opts = {}) => {
            const t = { message, ...opts, closed: false };
            toasts.push(t);
            return () => { t.closed = true; };
        },
        schedule: (fn) => (timers.push(fn), timers.length),
        unschedule: () => {},
    });
    return { store, actions, sent, toasts, timers, release, tick: (ms) => { clock += ms; } };
}

const statuses = (store) => store.view.routines.map((r) => `${r.automationId}:${r.status}`).join(' ');

describe('optimistic changes', () => {
    it('draw at once and stay drawn once Amazon confirms', async () => {
        const { store, actions, release, toasts } = setup();
        const done = actions.setStatus(store.view.routines[0], 'DISABLED');
        assert.equal(statuses(store), 'a:DISABLED b:ENABLED c:ENABLED');
        assert.equal(store.saving(), 1);
        assert.ok(store.isPending('a'));
        release();
        await done;
        assert.equal(store.saving(), 0);
        assert.equal(statuses(store), 'a:DISABLED b:ENABLED c:ENABLED', 'still drawn until a newer snapshot');
        assert.equal(toasts.at(-1).type, 'success');
    });

    it('go back to Amazon\'s state when refused, and say why with a retry', async () => {
        const { store, actions, release, toasts } = setup({ fail: () => 'phrase already used by: b' });
        const done = actions.editPhrases(store.view.routines[0], { add: ['b'] });
        assert.deepEqual(store.view.routines[0].triggers[0].payload.utterances, ['a', 'b']);
        release();
        await done;
        assert.deepEqual(store.view.routines[0].triggers[0].payload.utterances, ['a']);
        const error = toasts.at(-1);
        assert.equal(error.type, 'error');
        assert.equal(error.detail, 'Phrase déjà utilisée par « b ».');
        assert.equal(error.action.label, 'Réessayer');
    });

    it('undo one change without disturbing another in flight', async () => {
        const { store, actions, release, sent, toasts } = setup();
        const statusChange = actions.setStatus(store.view.routines[1], 'DISABLED');
        const deletion = actions.deleteRoutine(store.view.routines[0]);
        assert.equal(statuses(store), 'b:DISABLED c:ENABLED');
        toasts.find((t) => t.action && t.action.label === 'Annuler').action.run();
        await deletion;
        assert.equal(statuses(store), 'a:ENABLED b:DISABLED c:ENABLED');
        release();
        await statusChange;
        assert.deepEqual(sent.map(([c]) => c), ['disable'], 'the undone deletion was never sent');
    });

    it('send a deletion only once the undo window is over', async () => {
        const { store, actions, release, sent, timers } = setup();
        const deletion = actions.deleteRoutine(store.view.routines[2]);
        assert.equal(sent.length, 0);
        assert.deepEqual(store.view.audit, [], 'the audit entry goes with it');
        timers[0]();
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
        assert.equal(statuses(store).split(' ')[0], 'a:DISABLED');
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

    it('draw a new routine as a draft until it exists', async () => {
        const { store, actions, release } = setup();
        const done = actions.create(['lance Kodi'], 'Télé', 'turnOn');
        const draft = store.view.routines.at(-1);
        assert.equal(draft.draft, true);
        assert.equal(draft.sequence.startNode.operationPayload.target, 'tv-ha');
        release();
        await done;
    });

    it('offer to force a device deletion refused because routines use it', async () => {
        const { store, actions, release, toasts, timers } = setup({ fail: (c, b) => (b.force ? null : 'still used by 1 routine(s): a (--force to delete anyway)') });
        store.receive('appliances', [{ applianceId: 'SKILL_tcl', entityId: 'tv-tcl', friendlyName: 'Smart TV' }]);
        const done = actions.forget(store.view.appliances[0]);
        timers[0]();
        release();
        await done;
        assert.equal(store.view.appliances.length, 1, 'back after the refusal');
        const offer = toasts.at(-1);
        assert.equal(offer.action.label, 'Forcer');
        assert.match(offer.detail, /Encore utilisé par : a\./);
    });
});

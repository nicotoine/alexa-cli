// Every change the page can make: drawn at once (store), followed in the activity queue (activity), sent in the
// background (change). A deletion waits behind an undo window before anything is sent; a refusal undoes the
// drawing and the queue says why, with a retry. Pure of the DOM: tested in Node.

import { fromSpec } from '../../../../src/routine-spec.js';
import { editedPhrases, eachAction, idsOfName, label } from './model.js';

const findRoutine = (view, id) => (view.routines || []).find((r) => r.automationId === id);

export function createActions({ store, change, activity, explain, resync = () => {}, undoMs = 5000, schedule = setTimeout, unschedule = clearTimeout }) {
    let tempSeq = 0;

    /** Resolves once the change is answered, undone or refused. */
    function optimistic(spec) {
        const { key, kinds, patch, command, body, what, done, undo = false, onError } = spec;
        const op = store.begin({ key, kinds, patch });
        let id = null;

        const fail = (message) => {
            store.cancel(op);
            if (onError && onError(message, id)) return;
            activity.update(id, {
                state: 'failed',
                detail: explain(message),
                retry: () => {
                    activity.dismiss(id);
                    return optimistic({ ...spec, undo: false });
                },
            });
        };

        const send = async () => {
            activity.update(id, { state: 'running', deadline: null, undo: null });
            try {
                await change(command, { ...body, apply: true });
                store.confirm(op);
                activity.update(id, { state: 'done', detail: done || null });
                resync();
            } catch (e) {
                fail(e.message);
            }
        };

        if (!undo) {
            id = activity.add({ label: what, state: 'running' });
            return send();
        }
        return new Promise((resolve) => {
            let timer = null;
            id = activity.add({
                label: what,
                state: 'waiting',
                deadline: Date.now() + undoMs,
                undo: () => {
                    unschedule(timer);
                    store.cancel(op);
                    activity.update(id, { state: 'cancelled', undo: null, deadline: null, detail: 'Annulé' });
                    resolve();
                },
            });
            timer = schedule(() => send().then(resolve), undoMs);
        });
    }

    const actions = {
        optimistic,

        setStatus(r, status) {
            const id = r.automationId;
            const on = status === 'ENABLED';
            return optimistic({
                key: id, kinds: ['routines'],
                patch: (v) => { const x = findRoutine(v, id); if (x) x.status = status; },
                command: on ? 'enable' : 'disable', body: { target: id },
                what: `${on ? 'Activer' : 'Désactiver'} « ${label(r)} »`,
                done: on ? 'Activée' : 'Désactivée',
            });
        },

        editPhrases(r, { add = [], remove = [] }) {
            const id = r.automationId;
            const what = add.length ? `Ajouter « ${add[0]} »` : `Retirer « ${remove[0]} »`;
            return optimistic({
                key: id, kinds: ['routines'],
                patch: (v) => {
                    const t = (findRoutine(v, id)?.triggers || []).find((x) => x.type === 'CustomUtterance');
                    if (!t) return;
                    const payload = typeof t.payload === 'string' ? JSON.parse(t.payload) : t.payload;
                    const next = editedPhrases(payload.utterances || [payload.utterance], { add, remove });
                    t.payload = { ...payload, utterances: next, utterance: next[0] };
                },
                command: 'phrases', body: { target: id, add, remove },
                what: `${what} — ${label(r)}`,
                done: 'Enregistré',
            });
        },

        deleteRoutine(r) {
            const id = r.automationId;
            return optimistic({
                key: id, kinds: ['routines', 'audit'],
                patch: (v) => {
                    if (v.routines) v.routines = v.routines.filter((x) => x.automationId !== id);
                    if (v.audit) v.audit = v.audit.filter((x) => x.automationId !== id);
                },
                command: 'delete', body: { target: id },
                what: `Supprimer « ${label(r)} »`,
                done: 'Supprimée chez Amazon',
                undo: true,
            });
        },

        retarget(r, fromName, toName) {
            const id = r.automationId;
            const to = [...idsOfName(store.view, toName)][0];
            const from = fromName ? idsOfName(store.view, fromName) : null;
            return optimistic({
                key: id, kinds: ['routines'],
                patch: (v) => {
                    const x = findRoutine(v, id);
                    if (x && to) eachAction(x, (p) => { if (p.target && (!from || from.has(p.target))) p.target = to; });
                },
                command: 'retarget', body: { target: id, device: toName, ...(fromName ? { from: fromName } : {}) },
                what: `« ${label(r)} » → ${toName}`,
                done: `Vise maintenant ${toName}`,
            });
        },

        /**
         * A whole routine from the editor: created, or replacing `existing` (same id). Drawn with the same
         * translation the CLI uses, so what shows is what will be written.
         */
        save(spec, existing = null) {
            let drawn;
            try {
                drawn = fromSpec(spec, { devices: store.view.devices || [], echos: store.view.echos || [], customerId: 'pending' });
            } catch (e) {
                const id = activity.add({ label: `Enregistrer « ${spec.name || 'routine'} »`, state: 'running' });
                activity.update(id, { state: 'failed', detail: explain(e.message) });
                return Promise.resolve();
            }
            const id = existing ? existing.automationId : `draft-${++tempSeq}`;
            const routine = { ...drawn, automationId: id, ...(existing ? {} : { draft: true }) };
            return optimistic({
                key: id, kinds: ['routines'],
                patch: (v) => {
                    if (!v.routines) return;
                    const at = v.routines.findIndex((x) => x.automationId === id);
                    if (at >= 0) v.routines[at] = structuredClone(routine);
                    else v.routines.push(structuredClone(routine));
                },
                command: existing ? 'update' : 'create',
                body: existing ? { target: existing.automationId, spec } : { spec },
                what: `${existing ? 'Modifier' : 'Créer'} « ${drawn.name} »`,
                done: existing ? 'Modifiée' : 'Créée',
            });
        },

        forget(appliance, force = false) {
            const ids = new Set([appliance.applianceId, appliance.entityId, appliance.id].filter(Boolean));
            return optimistic({
                key: appliance.applianceId, kinds: ['appliances', 'devices', 'skills'],
                patch: (v) => {
                    if (v.appliances) v.appliances = v.appliances.filter((x) => x.applianceId !== appliance.applianceId);
                    if (v.devices) v.devices = v.devices.filter((d) => !ids.has(d.id));
                    for (const s of v.skills || []) s.devices = s.devices.filter((d) => d.applianceId !== appliance.applianceId);
                },
                command: 'forget', body: { target: appliance.applianceId, ...(force ? { force: true } : {}) },
                what: `Supprimer l'appareil « ${appliance.friendlyName} »`,
                done: 'Supprimé d\'Alexa',
                undo: !force,
                onError: (message, id) => {
                    if (!/still used by/.test(message)) return false;
                    activity.update(id, {
                        state: 'failed',
                        detail: `${explain(message)} Le supprimer cassera ces routines.`,
                        action: { label: 'Forcer', run: () => { activity.dismiss(id); return actions.forget(appliance, true); } },
                    });
                    return true;
                },
            });
        },

        async run(r) {
            const id = activity.add({ label: `Lancer « ${label(r)} »`, state: 'running' });
            try {
                await change('run', { target: r.automationId, apply: true });
                activity.update(id, { state: 'done', detail: 'Lancée' });
            } catch (e) {
                activity.update(id, { state: 'failed', detail: explain(e.message), retry: () => { activity.dismiss(id); return actions.run(r); } });
            }
        },
    };
    return actions;
}

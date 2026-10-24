// Every change the page can make, drawn at once and sent in the background. A deletion waits a few seconds behind
// an "Annuler" toast before anything is sent; a refusal undoes the drawing and says why, with a way to retry.

import { editedPhrases, eachAction, idsOfName, label } from './model.js';

const findRoutine = (view, id) => (view.routines || []).find((r) => r.automationId === id);

export function createActions({ store, change, toast, explain, resync = () => {}, undoMs = 5000, schedule = setTimeout, unschedule = clearTimeout }) {
    let tempSeq = 0;

    /** Resolves once the change is sent and answered, undone, or refused. */
    function optimistic(spec) {
        const { key, kinds, patch, command, body, what, done, undo = false, onError } = spec;
        const op = store.begin({ key, kinds, patch });

        const fail = (message) => {
            store.cancel(op);
            if (onError && onError(message)) return;
            toast(`Échec : ${what}`, { type: 'error', detail: explain(message), action: { label: 'Réessayer', run: () => optimistic({ ...spec, undo: false }) } });
        };

        const send = async () => {
            try {
                await change(command, { ...body, apply: true });
                store.confirm(op);
                if (done) toast(done, { type: 'success' });
                resync();
            } catch (e) {
                fail(e.message);
            }
        };

        if (!undo) return send();
        return new Promise((resolve) => {
            let timer = null;
            const dismiss = toast(what, {
                duration: undoMs,
                action: {
                    label: 'Annuler',
                    run: () => {
                        unschedule(timer);
                        store.cancel(op);
                        resolve();
                    },
                },
            });
            timer = schedule(() => {
                dismiss();
                send().then(resolve);
            }, undoMs);
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
                done: `« ${label(r)} » ${on ? 'activée' : 'désactivée'}`,
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
                done: `${what} : enregistré`,
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
                what: `Routine « ${label(r)} » supprimée`,
                done: `« ${label(r)} » supprimée chez Amazon`,
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
                done: `« ${label(r)} » vise maintenant ${toName}`,
            });
        },

        create(phrases, device, op) {
            const tempId = `pending-${++tempSeq}`;
            const target = [...idsOfName(store.view, device)][0];
            return optimistic({
                key: tempId, kinds: ['routines'],
                patch: (v) => {
                    if (!v.routines || v.routines.some((x) => x.automationId === tempId)) return;
                    v.routines.push({
                        automationId: tempId, name: phrases[0], status: 'ENABLED', draft: true,
                        triggers: [{ type: 'CustomUtterance', payload: { utterance: phrases[0], utterances: phrases } }],
                        sequence: { startNode: { '@type': 'OpaquePayloadOperationNode', operationPayload: { target, operations: [{ type: op }] } } },
                    });
                },
                command: 'create', body: { phrase: phrases, device, op },
                what: `Créer « ${phrases[0]} »`,
                done: `Routine « ${phrases[0]} » créée`,
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
                what: `Appareil « ${appliance.friendlyName} » supprimé`,
                done: `« ${appliance.friendlyName} » supprimé d'Alexa`,
                undo: !force,
                onError: (message) => {
                    if (!/still used by/.test(message)) return false;
                    toast(`« ${appliance.friendlyName} » n'a pas été supprimé`, {
                        type: 'error',
                        detail: `${explain(message)} Le supprimer cassera ces routines.`,
                        action: { label: 'Forcer', run: () => actions.forget(appliance, true) },
                    });
                    return true;
                },
            });
        },

        async run(r) {
            const dismiss = toast(`Lancement de « ${label(r)} »…`, { duration: 0 });
            try {
                await change('run', { target: r.automationId, apply: true });
                dismiss();
                toast(`« ${label(r)} » lancée`, { type: 'success' });
            } catch (e) {
                dismiss();
                toast(`Échec du lancement de « ${label(r)} »`, { type: 'error', detail: explain(e.message) });
            }
        },
    };
    return actions;
}

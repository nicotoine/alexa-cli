// What a routine, a device and a skill look like in the Alexa app's API, and how to read and write them.
// Nothing here talks to the network: the one call a write needs (/operation/validate) is passed in, so all of it
// is tested offline.
//
// The write format, the rebuild-and-PUT mechanism behind every edit and the audit follow snordquist/alexa-mcp
// (MIT, https://github.com/snordquist/alexa-mcp), which reverse-engineered the Alexa app.

export const LOCALE = 'fr-FR';
export const MARKETPLACE_FR = 'A13V1IB3VIYZZH';

const T_TRIGGER = 'com.amazon.alexa.behaviors.model.Trigger';
const T_UTTERANCE = 'com.amazon.alexa.behaviors.model.CustomUtteranceTriggerPayload';
const T_SEQUENCE = 'com.amazon.alexa.behaviors.model.Sequence';
const T_OP_NODE = 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode';

export const OPERATIONS = ['turnOn', 'turnOff'];

// ---- encoding ---------------------------------------------------------------------------------------------

// JSON with every non-ASCII character as a \u escape. alexa-remote2 writes request bodies without a charset, and
// Amazon then stored "télé" as "tÃ©lÃ©" — a phrase no one can say. Escaped, the text arrives intact.
export function asciiJson(value) {
    return JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

const decode = (payload) => (typeof payload === 'string' ? JSON.parse(payload) : payload);

// ---- devices ----------------------------------------------------------------------------------------------

export function deviceName(d) {
    return d.displayName || d.friendlyName || d.name || '';
}

// A device answers to several ids depending on who lists it: routine entities use `id`, the appliance list
// `applianceId` and `entityId`. Routines may reference any of them.
export function deviceIds(d) {
    return [d.id, d.entityId, d.applianceId, d.endpointId].filter(Boolean);
}

/**
 * What a routine can act on: the routine entities, plus the appliances Amazon has not added to that list yet (a
 * device found a few minutes ago is an appliance long before it is an entity). Routines target a device by its
 * entity id, so a missing one is added under that id; one already listed is not added twice.
 */
export function routineTargetsList(entities, appliances = []) {
    const known = new Set(entities.flatMap(deviceIds));
    const missing = appliances
        .filter((a) => a.entityId && !known.has(a.entityId))
        .map((a) => ({ id: a.entityId, displayName: deviceName(a) }));
    return [...entities, ...missing];
}

export function findByName(list, key, what = 'device') {
    const k = key.toLowerCase();
    const hits = list.filter((d) => deviceName(d).toLowerCase() === k || deviceIds(d).includes(key));
    if (hits.length === 1) return hits[0];
    if (hits.length === 0) throw new Error(`no ${what} is named "${key}"`);
    throw new Error(`${hits.length} ${what}s are named "${key}"; use the id`);
}

// Every id of every device listed under that name. The same device shows up twice (as a routine entity and as
// an appliance), so a lookup by name that must match "this device" takes the union rather than refusing.
export function idsOfName(lists, key) {
    const k = key.toLowerCase();
    return new Set(lists.flat()
        .filter((d) => deviceName(d).toLowerCase() === k || deviceIds(d).includes(key))
        .flatMap(deviceIds));
}

// Where the appliance list nests its entries changes with the account; take every object that is one.
export function flattenAppliances(raw) {
    const found = new Map();
    const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        if (n.applianceId && n.friendlyName) found.set(n.applianceId, n);
        Object.values(n).forEach(walk);
    };
    walk(raw);
    return [...found.values()];
}

/**
 * Echos and the Alexa apps that can answer an action. Amazon lists the Alexa app on each phone only inside
 * another device's appDeviceList, with no name: they are added under their serial number, which is how a
 * routine names them (a "good morning" played on the phone, made in the app, targets one).
 */
export function flattenEchos(devices) {
    const seen = new Map();
    for (const d of devices || []) {
        if (d.serialNumber) seen.set(d.serialNumber, d);
        for (const app of d.appDeviceList || []) {
            if (app.serialNumber && !seen.has(app.serialNumber)) {
                seen.set(app.serialNumber, { ...app, accountName: null, deviceFamily: 'ALEXA_APP' });
            }
        }
    }
    return [...seen.values()];
}

export function applianceSource(a) {
    const prefix = String(a.applianceId).split('_')[0];
    return { AAA: 'matter', SKILL: 'skill' }[prefix] || prefix.toLowerCase();
}

// ---- skills -----------------------------------------------------------------------------------------------

// The skill behind a skill-provided appliance: driverIdentity.identifier is base64 JSON {"skillId", "stage"}.
export function skillIdOf(appliance) {
    const id = appliance.driverIdentity;
    if (!id || id.namespace !== 'SKILL' || !id.identifier) return null;
    try {
        return JSON.parse(Buffer.from(id.identifier, 'base64').toString('utf8')).skillId || null;
    } catch {
        return null;
    }
}

// Amazon's "your skills" page merged with the skills that provide smart-home devices: the page leaves most
// smart-home skills out (TCL, Smart Life, Tapo were missing from a real account), their devices name them.
export function mergeSkills(listed, appliances) {
    const byId = new Map();
    for (const s of listed || []) byId.set(s.id, { id: s.id, name: s.name, type: s.type, listed: true, devices: [] });
    for (const a of appliances || []) {
        const id = skillIdOf(a);
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, { id, name: null, type: 'SMART_HOME', listed: false, devices: [] });
        const s = byId.get(id);
        s.name = s.name || a.manufacturerName || null;
        s.devices.push({ name: deviceName(a), applianceId: a.applianceId });
    }
    return [...byId.values()].sort((a, b) => b.devices.length - a.devices.length || String(a.name).localeCompare(String(b.name)));
}

// ---- routines: reading ------------------------------------------------------------------------------------

export function phrasesOf(routine) {
    return (routine.triggers || [])
        .flatMap((t) => (t.payload && (decode(t.payload).utterances || [decode(t.payload).utterance])) || [])
        .filter(Boolean);
}

export function routineLabel(r) {
    return r.name || phrasesOf(r).join(' / ') || '(no name)';
}

export function findRoutine(list, key) {
    const k = key.toLowerCase();
    const hits = list.filter((r) => r.automationId === key
        || (r.name || '').toLowerCase() === k
        || phrasesOf(r).some((p) => p.toLowerCase() === k));
    if (hits.length === 1) return hits[0];
    if (hits.length === 0) throw new Error(`no routine matches "${key}"`);
    throw new Error(`"${key}" matches ${hits.length} routines; use the id`);
}

// Placeholders that are not devices: the Echo that heard the phrase, a skill, "all the lights" (virtual@LIGHT@…).
const NOT_A_DEVICE = /^ALEXA_|CURRENT|^amzn1\.|^virtual@/i;

// The device actions of a routine: which device, which operation.
export function routineTargets(routine) {
    const out = [];
    walkOperations(routine.sequence, (p, node) => {
        if (p.target && !NOT_A_DEVICE.test(p.target)) {
            out.push({ target: p.target, op: (p.operations || []).map((o) => o.type).join(',') || node.type });
        }
    });
    return out;
}

function walkOperations(n, fn) {
    if (Array.isArray(n)) return n.forEach((x) => walkOperations(x, fn));
    if (!n || typeof n !== 'object') return;
    if (String(n['@type'] || '').endsWith('OperationNode') && n.operationPayload) fn(decode(n.operationPayload), n);
    Object.values(n).forEach((x) => walkOperations(x, fn));
}

export function customerIdOf(routines) {
    for (const r of routines) {
        if (r.owner && r.owner.id) return r.owner.id;
        const t = (r.triggers || []).find((x) => x.payload && decode(x.payload).customerId);
        if (t) return decode(t.payload).customerId;
    }
    throw new Error('could not find the Amazon customer id in the existing routines');
}

export function checkPhrasesFree(routines, phrases, except = null) {
    const lower = phrases.map((p) => p.toLowerCase());
    const taken = routines.filter((r) => r !== except && phrasesOf(r).some((p) => lower.includes(p.toLowerCase())));
    if (taken.length) throw new Error(`phrase already used by: ${taken.map(routineLabel).join(', ')}`);
}

// The phrases of a routine after adding and removing some; additions already there (in any case) are ignored.
export function editedPhrases(current, { add = [], remove = [] }) {
    const drop = remove.map((p) => p.toLowerCase());
    const kept = current.filter((p) => !drop.includes(p.toLowerCase()));
    const added = add.filter((p) => !kept.some((c) => c.toLowerCase() === p.toLowerCase()));
    return [...kept, ...added];
}

// Routines whose device actions point at a device that no longer exists.
export function brokenRoutines(routines, entities, appliances) {
    const all = [...entities, ...appliances];
    const known = new Set(all.flatMap(deviceIds));
    const names = new Map(all.flatMap((d) => deviceIds(d).map((id) => [id, deviceName(d)])));
    return routines
        .map((r) => ({
            name: routineLabel(r),
            automationId: r.automationId,
            missing: routineTargets(r).filter((t) => !known.has(t.target)).map((t) => ({ ...t, name: names.get(t.target) || null })),
        }))
        .filter((r) => r.missing.length);
}

// ---- routines: writing ------------------------------------------------------------------------------------
//
// The Alexa app writes a flat body whose trigger and sequence are JSON strings, with the trigger payload a JSON
// string inside that, and every action normalised by /operation/validate first. Bad input still answers HTTP
// 200, with {"message":"Input failed to validate."}: callers check the answer, not the status.

export function writeBody({ name, status, triggers, sequence, behaviorId }) {
    const triggerJsons = triggers.map((t) => JSON.stringify(t));
    return {
        ...(behaviorId ? { behaviorId } : {}),
        name,
        status,
        triggerJson: triggerJsons[0],
        triggerJsonList: triggerJsons,
        sequenceJson: JSON.stringify(sequence),
    };
}

export function utteranceTrigger(phrases, customerId) {
    return {
        '@type': T_TRIGGER,
        id: null,
        skillId: null,
        type: 'CustomUtterance',
        payload: JSON.stringify({
            '@type': T_UTTERANCE,
            locale: LOCALE,
            marketplaceId: MARKETPLACE_FR,
            utterance: phrases[0],
            utterances: phrases,
            customerId,
            person: null,
        }),
    };
}

export function smartHomeOperation({ target, op, customerId }) {
    return { target, customerId, operations: [{ type: op }], locale: LOCALE };
}

export function smartHomeSequence(operationPayload) {
    return {
        '@type': T_SEQUENCE,
        startNode: { '@type': T_OP_NODE, type: 'Alexa.SmartHome.Batch', skillId: 'amzn1.ask.1p.smarthome', operationPayload, context: null },
    };
}

/**
 * A saved routine in write form, with edits applied to its decoded trigger payloads and action payloads.
 * Every action goes through `validate(type, payload)` again, as the app does when it saves (there is no
 * status-only or phrases-only endpoint: an edit is a full PUT).
 */
export async function rebuildBody(routine, { status, editTrigger, editAction } = {}, validate) {
    const triggers = (routine.triggers || []).map((t) => {
        const payload = structuredClone(decode(t.payload));
        if (editTrigger) editTrigger(payload, t);
        return { '@type': T_TRIGGER, id: null, skillId: t.skillId || null, type: t.type, payload: JSON.stringify(payload) };
    });
    if (!triggers.length) throw new Error('the routine has no trigger');
    const node = async (n) => {
        if (!n || typeof n !== 'object') return n;
        if (String(n['@type'] || '').endsWith('OpaquePayloadOperationNode')) {
            let p = structuredClone(decode(n.operationPayload) || {});
            if (editAction) p = editAction(p, n) || p;
            return { '@type': n['@type'], type: n.type, skillId: n.skillId || null, operationPayload: await validate(n.type, p), context: null };
        }
        if (Array.isArray(n.nodesToExecute)) return { '@type': n['@type'], nodesToExecute: await Promise.all(n.nodesToExecute.map(node)) };
        return n;
    };
    const sequence = { '@type': T_SEQUENCE, startNode: await node(routine.sequence && routine.sequence.startNode) };
    return writeBody({ name: routine.name, status: status || routine.status, triggers, sequence, behaviorId: routine.automationId });
}

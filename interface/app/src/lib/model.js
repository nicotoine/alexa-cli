// Reading routines and devices as the page shows them. Pure functions: tested in Node.

export const OPS = { turnOn: 'allumer', turnOff: 'éteindre' };

const decode = (p) => (typeof p === 'string' ? JSON.parse(p) : p);

export function phrasesOf(r) {
    return (r.triggers || [])
        .flatMap((t) => (t.payload && (decode(t.payload).utterances || [decode(t.payload).utterance])) || [])
        .filter(Boolean);
}

export function label(r) {
    return r.name || phrasesOf(r).join(' / ') || '(sans nom)';
}

export const isVoice = (r) => (r.triggers || []).some((t) => t.type === 'CustomUtterance');

/** Calls fn(payload, node) on every action of a routine; payloads given as strings are decoded in place. */
export function eachAction(r, fn) {
    const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        if (String(n['@type'] || '').endsWith('OperationNode') && n.operationPayload) {
            if (typeof n.operationPayload === 'string') {
                try { n.operationPayload = JSON.parse(n.operationPayload); } catch { n.operationPayload = {}; }
            }
            fn(n.operationPayload, n);
        }
        Object.values(n).forEach(walk);
    };
    walk(r.sequence);
}

/** What a routine does, action by action: a device and an operation, something said, or another kind. */
export function actionsOf(r) {
    const out = [];
    eachAction(r, (p, n) => {
        if (p.target) out.push({ target: p.target, op: (p.operations || []).map((o) => o.type).join(',') });
        else if (p.textToSpeak) out.push({ speak: p.textToSpeak });
        else if (n.type === 'Alexa.System.Wait') out.push({ wait: p.waitTimeInSeconds });
        else if (n.type === 'Alexa.TextCommand') out.push({ command: p.text });
        else out.push({ type: n.type });
    });
    return out;
}

const GROUPS = { 'virtual@LIGHT': 'toutes les lumières', 'virtual@SMARTPLUG': 'toutes les prises' };

/** id → name, for every id a device answers to. */
export function deviceNames(view) {
    const names = new Map();
    for (const d of view.devices || []) names.set(d.id, d.displayName);
    for (const a of view.appliances || []) for (const id of [a.applianceId, a.entityId, a.id]) if (id) names.set(id, a.friendlyName);
    return names;
}

export function targetName(target, names) {
    return names.get(target) || GROUPS[target.split('@').slice(0, 2).join('@')] || null;
}

/** Every id of every device listed under that name (a device is listed as entity and as appliance). */
export function idsOfName(view, name) {
    const k = name.toLowerCase();
    return new Set([
        ...(view.devices || []).filter((d) => d.displayName.toLowerCase() === k).map((d) => d.id),
        ...(view.appliances || []).filter((a) => a.friendlyName.toLowerCase() === k).flatMap((a) => [a.applianceId, a.entityId, a.id]),
    ].filter(Boolean));
}

export function phraseOwner(routines, phrase, exceptId = null) {
    const k = phrase.toLowerCase();
    return (routines || []).find((r) => r.automationId !== exceptId && phrasesOf(r).some((p) => p.toLowerCase() === k)) || null;
}

/** The phrases of a routine after an edit; mirrors the CLI so the drawn result is the saved one. */
export function editedPhrases(current, { add = [], remove = [] }) {
    const drop = remove.map((p) => p.toLowerCase());
    const kept = current.filter((p) => !drop.includes(p.toLowerCase()));
    return [...kept, ...add.filter((p) => !kept.some((c) => c.toLowerCase() === p.toLowerCase()))];
}

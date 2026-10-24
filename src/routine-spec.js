// A routine as a person writes it (the "spec"), and the translation to and from Amazon's format.
//
//   { "name": "bonne nuit", "enabled": true,
//     "when": { "say": ["bonne nuit"] }                      — or { "at": "07:30", "days": ["MO", "FR"] }
//     "do": [ { "device": "Télé", "turn": "off" },           — actions, run in order
//             { "wait": 10 }, { "say": "…", "on": "Salon" }, { "play": "weather" },
//             { "command": "mets de la musique" }, { "fireTv": "off", "on": "Fire tv" },
//             { "play": "weather" | "time" | "date" | "calendar" | "news" | "goodmorning" },
//             { "raw": { "type", "skillId", "payload" } } ] }  — any other action, kept as Amazon wrote it
//
// `on` names the Echo that answers; without it, the one that heard the phrase answers. A scheduled routine has
// no such Echo, so there `on` is required.
//
// "do" is a flat list because that is what Amazon keeps. Whatever nesting is sent, Amazon stores the actions in
// order and groups them itself: consecutive device actions run together with the one action that follows them
// (seen on a real account: [device, device, wait, say] came back as together{device, device, wait}, say; two
// "say" sent together came back one after the other). So the spec reads a routine as that flat list, and writing
// it back lets Amazon rebuild the same groups. "together" and "steps" are still read, and flattened.
//
// Pure: device and Echo names are resolved through the lists passed in, and nothing is sent. Every action still
// goes through /operation/validate when it is written (see writeSpecBody).

import { LOCALE, MARKETPLACE_FR, deviceIds, deviceName, findByName } from './model.js';

const T = 'com.amazon.alexa.behaviors.model.';
const CURRENT = { deviceType: 'ALEXA_CURRENT_DEVICE_TYPE', deviceSerialNumber: 'ALEXA_CURRENT_DSN' };

// "play" actions: the spec word, Amazon's type and skill. All are spoken by an Echo.
export const PLAYS = {
    weather: ['Alexa.Weather.Play', 'amzn1.ask.1p.weather'],
    time: ['Alexa.Time.Play', 'amzn1.ask.1p.dateandtime'],
    date: ['Alexa.Date.Play', 'amzn1.ask.1p.dateandtime'],
    calendar: ['Alexa.Calendar.PlayToday', 'amzn1.ask.1p.calendar'],
    news: ['Alexa.News.NationalNews', 'amzn1.ask.1p.nationalnews'],
    goodmorning: ['Alexa.GoodMorning.Play', 'amzn1.ask.1p.saysomething'],
};
const PLAY_BY_TYPE = Object.fromEntries(Object.entries(PLAYS).map(([k, [type]]) => [type, k]));
const SKILLS = {
    'Alexa.SmartHome.Batch': 'amzn1.ask.1p.smarthome',
    'Alexa.Speak': 'amzn1.ask.1p.saysomething',
    'Alexa.System.Wait': 'amzn1.ask.1p.wait',
    'Alexa.TextCommand': 'amzn1.ask.1p.tellalexa',
    'Alexa.Operation.FireTV.TurnOff': 'amzn1.ask.1p.routines.firetv',
};
export const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const TURN = { on: 'turnOn', off: 'turnOff' };

export class SpecError extends Error {}

const decode = (p) => (typeof p === 'string' ? JSON.parse(p) : p);

// ---- Amazon → spec ----------------------------------------------------------------------------------------

/**
 * The spec of a saved routine. `devices` (entities and appliances alike) and `echos` turn ids back into names;
 * an id no list knows is kept as is, so the spec still round-trips.
 */
export function toSpec(routine, { devices = [], echos = [] } = {}) {
    const deviceName_ = new Map(devices.flatMap((d) => deviceIds(d).map((id) => [id, deviceName(d)])));
    const echoName = new Map(echos.flatMap((e) => [[e.serialNumber, e.accountName], [e.deviceAccountId, e.accountName]]));
    const onOf = (p) => (p.deviceSerialNumber && p.deviceSerialNumber !== CURRENT.deviceSerialNumber
        ? { on: echoName.get(p.deviceSerialNumber) || p.deviceSerialNumber } : {});

    const step = (n) => {
        const type = String(n['@type'] || '');
        if (type.endsWith('SerialNode')) return { steps: (n.nodesToExecute || []).map(step) };
        if (type.endsWith('ParallelNode')) return { together: (n.nodesToExecute || []).map(step) };
        const p = decode(n.operationPayload) || {};
        switch (n.type) {
        case 'Alexa.SmartHome.Batch': {
            const op = (p.operations || [])[0]?.type;
            const turn = Object.keys(TURN).find((k) => TURN[k] === op);
            if (turn && (p.operations || []).length === 1) return { device: deviceName_.get(p.target) || p.target, turn };
            break;
        }
        case 'Alexa.Speak':
            if (p.textToSpeak !== undefined) return { say: p.textToSpeak, ...onOf(p) };
            break;
        case 'Alexa.System.Wait':
            return { wait: p.waitTimeInSeconds };
        case 'Alexa.TextCommand':
            return { command: p.text, ...onOf(p) };
        case 'Alexa.Operation.FireTV.TurnOff':
            return { fireTv: 'off', on: echoName.get(p.deviceAccountId) || p.deviceAccountId };
        default:
            if (PLAY_BY_TYPE[n.type]) return { play: PLAY_BY_TYPE[n.type], ...onOf(p) };
        }
        return { raw: { type: n.type, skillId: n.skillId || null, payload: p } };
    };

    const start = routine.sequence && routine.sequence.startNode;
    const spec = {
        name: routine.name || null,
        enabled: routine.status !== 'DISABLED',
        when: whenOf(routine.triggers || []),
        do: start ? flatSteps([step(start)]) : [],
    };
    if (routine.condition) spec.conditions = { raw: routine.condition };
    return spec;
}

/** Actions in order, groups dissolved (see the note at the top: Amazon makes its own groups). */
export function flatSteps(steps) {
    return steps.flatMap((s) => (s.together || s.steps ? flatSteps(s.together || s.steps) : [s]));
}

/** Whether a spec holds groups Amazon will not keep as written. */
export const specHasGroups = (spec) => (spec.do || []).some((s) => s.together || s.steps);

function whenOf(triggers) {
    if (triggers.length !== 1) return { raw: triggers };
    const t = triggers[0];
    const p = decode(t.payload) || {};
    if (t.type === 'CustomUtterance') return { say: p.utterances || [p.utterance] };
    if (t.type === 'AbsoluteTimeSchedule' && p.schedule) {
        const time = String(p.schedule.triggerTime || '');
        const days = (String(p.schedule.recurrence || '').match(/BYDAY=([A-Z,]+)/) || [])[1];
        return {
            at: `${time.slice(0, 2)}:${time.slice(2, 4)}`,
            ...(days ? { days: days.split(',') } : {}),
            ...(p.schedule.timeZoneId ? { timezone: p.schedule.timeZoneId } : {}),
        };
    }
    return { raw: triggers };
}

// ---- spec → Amazon ----------------------------------------------------------------------------------------

/** Checks a spec's shape before any name is looked up; throws SpecError naming the first problem. */
export function checkSpec(spec) {
    const fail = (msg) => { throw new SpecError(msg); };
    if (!spec || typeof spec !== 'object') fail('the spec must be a JSON object');
    if (!spec.when || typeof spec.when !== 'object') fail('"when" is missing: { "say": [...] } or { "at": "HH:MM" }');
    if (spec.when.say !== undefined) {
        const say = [].concat(spec.when.say);
        if (!say.length || say.some((s) => typeof s !== 'string' || !s.trim())) fail('"when.say" needs at least one phrase');
    } else if (spec.when.at !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(spec.when.at)) fail('"when.at" must be HH:MM');
        for (const d of spec.when.days || []) if (!DAYS.includes(d)) fail(`"when.days" holds "${d}": use ${DAYS.join(', ')}`);
    } else if (spec.when.raw === undefined) {
        fail('"when" needs "say" or "at"');
    }
    if (!Array.isArray(spec.do) || !spec.do.length) fail('"do" needs at least one step');
    const scheduled = spec.when.at !== undefined;
    const walk = (steps, where) => steps.forEach((s, i) => {
        const at = `${where}[${i}]`;
        if (!s || typeof s !== 'object') fail(`${at} is not a step`);
        const kinds = ['device', 'say', 'wait', 'play', 'command', 'fireTv', 'together', 'steps', 'raw'].filter((k) => s[k] !== undefined);
        if (kinds.length !== 1) fail(`${at} must be exactly one of device, say, wait, play, command, fireTv, together, steps, raw`);
        const [kind] = kinds;
        if (kind === 'together' || kind === 'steps') {
            if (!Array.isArray(s[kind]) || !s[kind].length) fail(`${at}.${kind} needs at least one step`);
            return walk(s[kind], `${at}.${kind}`);
        }
        if (kind === 'device' && !TURN[s.turn]) fail(`${at} needs "turn": "on" or "off"`);
        if (kind === 'wait' && !(Number.isInteger(s.wait) && s.wait > 0 && s.wait <= 3600)) fail(`${at}.wait must be 1 to 3600 seconds`);
        if (kind === 'play' && !PLAYS[s.play]) fail(`${at}.play must be one of ${Object.keys(PLAYS).join(', ')}`);
        if ((kind === 'say' || kind === 'command') && (typeof s[kind] !== 'string' || !s[kind].trim())) fail(`${at}.${kind} needs a text`);
        if (kind === 'fireTv' && (s.fireTv !== 'off' || !s.on)) fail(`${at} needs "fireTv": "off" and "on": the Fire TV`);
        if (scheduled && ['say', 'play', 'command'].includes(kind) && !s.on) {
            fail(`${at} needs "on": a scheduled routine has no Echo that heard it, so say which one answers`);
        }
    });
    walk(spec.do, 'do');
    return spec;
}

/**
 * Amazon's routine (triggers and sequence, actions not yet validated) for a spec. `devices` are the routine
 * entities (client.entities(): a routine targets their id), `echos` resolve Echo names; `customerId` is the
 * account's.
 */
export function fromSpec(spec, { devices = [], echos = [], customerId, timezone = 'Europe/Paris' }) {
    checkSpec(spec);
    const echoBy = (name, what) => {
        const echo = findByName(echos.map((e) => ({ ...e, displayName: e.accountName, id: e.serialNumber })), name, 'Echo');
        if (what === 'fireTv') return { customerId, deviceAccountId: echo.deviceAccountId };
        return { deviceType: echo.deviceType, deviceSerialNumber: echo.serialNumber };
    };
    const speaker = (s) => ({ customerId, ...(s.on ? echoBy(s.on) : CURRENT), locale: LOCALE });
    const action = (type, payload, skillId = SKILLS[type]) => ({ '@type': `${T}OpaquePayloadOperationNode`, type, skillId, operationPayload: payload, context: null });

    const step = (s) => {
        if (s.together) return { '@type': `${T}ParallelNode`, nodesToExecute: s.together.map(step) };
        if (s.steps) return { '@type': `${T}SerialNode`, nodesToExecute: s.steps.map(step) };
        if (s.device !== undefined) {
            const target = deviceTarget(devices, s.device);
            return action('Alexa.SmartHome.Batch', { target, customerId, operations: [{ type: TURN[s.turn] }], locale: LOCALE });
        }
        if (s.say !== undefined) return action('Alexa.Speak', { ...speaker(s), textToSpeak: s.say });
        if (s.wait !== undefined) return action('Alexa.System.Wait', { waitTimeInSeconds: s.wait });
        if (s.play !== undefined) return action(PLAYS[s.play][0], speaker(s), PLAYS[s.play][1]);
        if (s.command !== undefined) return action('Alexa.TextCommand', { ...speaker(s), text: s.command });
        if (s.fireTv !== undefined) return action('Alexa.Operation.FireTV.TurnOff', echoBy(s.on, 'fireTv'));
        return action(s.raw.type, s.raw.payload, s.raw.skillId || null);
    };

    const nodes = flatSteps(spec.do).map(step);
    const startNode = nodes.length === 1 ? nodes[0] : { '@type': `${T}SerialNode`, nodesToExecute: nodes };
    return {
        name: spec.name || [].concat(spec.when.say || [])[0] || `routine ${spec.when.at}`,
        status: spec.enabled === false ? 'DISABLED' : 'ENABLED',
        triggers: triggersOf(spec.when, customerId, timezone),
        sequence: { '@type': `${T}Sequence`, startNode },
        condition: spec.conditions && spec.conditions.raw ? spec.conditions.raw : null,
    };
}

// An id written where a name is expected — a group such as virtual@LIGHT@… ("all the lights"), a device id, a
// target that no longer exists — is kept as is, so exporting and importing a routine loses none of its actions.
const LOOKS_LIKE_AN_ID = /^virtual@|^[0-9a-f]{8}-[0-9a-f]{4}-|^[A-Z]+_[A-Za-z0-9]/;

function deviceTarget(devices, value) {
    try {
        return deviceIds(findByName(devices, value))[0];
    } catch (e) {
        if (/no device is named/.test(e.message) && LOOKS_LIKE_AN_ID.test(value)) return value;
        throw e;
    }
}

function triggersOf(when, customerId, timezone) {
    if (when.raw) return when.raw;
    if (when.say !== undefined) {
        const phrases = [].concat(when.say);
        return [{
            '@type': `${T}Trigger`, id: null, skillId: null, type: 'CustomUtterance',
            payload: { '@type': `${T}CustomUtteranceTriggerPayload`, locale: LOCALE, marketplaceId: MARKETPLACE_FR,
                utterance: phrases[0], utterances: phrases, customerId, person: null },
        }];
    }
    const [h, m] = when.at.split(':');
    const recurrence = when.days && when.days.length ? `RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${when.days.join(',')}` : 'RRULE:FREQ=DAILY;INTERVAL=1';
    return [{
        '@type': `${T}Trigger`, id: null, skillId: 'amzn1.ask.1p.routines.schedule', type: 'AbsoluteTimeSchedule',
        // triggerTimes repeats the time: that is what the Alexa app writes (alexa-mcp sends an empty list).
        payload: { schedule: { '@type': 'RRULE', triggerTime: `${h}${m}00`, triggerTimes: [`${h}${m}00`], timeZoneId: when.timezone || timezone, recurrence },
            customer: { '@id': customerId, '@type': 'ac:Person' } },
    }];
}

/** Every voice phrase of a spec (to check none is taken). */
export const specPhrases = (spec) => [].concat((spec.when && spec.when.say) || []);

/**
 * The write body for a spec: triggers as JSON strings, every action through `validate(type, payload)`.
 * `behaviorId` makes it an update.
 */
export async function writeSpecBody(routine, validate, behaviorId) {
    const node = async (n) => {
        if (Array.isArray(n.nodesToExecute)) return { '@type': n['@type'], nodesToExecute: await Promise.all(n.nodesToExecute.map(node)) };
        return { ...n, operationPayload: await validate(n.type, n.operationPayload) };
    };
    const triggers = routine.triggers.map((t) => JSON.stringify({ ...t, payload: typeof t.payload === 'string' ? t.payload : JSON.stringify(t.payload) }));
    const sequence = { ...routine.sequence, startNode: await node(routine.sequence.startNode) };
    return {
        ...(behaviorId ? { behaviorId } : {}),
        name: routine.name,
        status: routine.status,
        triggerJson: triggers[0],
        triggerJsonList: triggers,
        sequenceJson: JSON.stringify(sequence),
        ...(routine.condition ? { conditionJson: JSON.stringify(routine.condition) } : {}),
    };
}

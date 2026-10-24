#!/usr/bin/env node
// alexa-cli: Alexa smart-home devices and voice routines from the command line.
// Uses the unofficial Alexa web API through alexa-remote2. Login happens on Amazon's own page through a
// local proxy (127.0.0.1 only); only the resulting tokens are stored, in ~/.config/alexa-cli/auth.json (0600).
// The routine write format, the update/enable mechanism, the audit and the reference-safe device delete follow
// snordquist/alexa-mcp (MIT, https://github.com/snordquist/alexa-mcp), which reverse-engineered the Alexa app.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Alexa = require('alexa-remote2');

const CONF_DIR = path.join(os.homedir(), '.config', 'alexa-cli');
const AUTH = path.join(CONF_DIR, 'auth.json');
const PROXY_PORT = 3456;
const LOCALE = 'fr-FR';
const MARKETPLACE_FR = 'A13V1IB3VIYZZH';
// The Alexa app version the write endpoints expect in the Routines-Version header (as sent by alexa-mcp).
const ROUTINES_VERSION = '3.0.264101';
const WRITE_HEADERS = { 'Content-Type': 'application/json', 'Routines-Version': ROUTINES_VERSION };

const T_TRIGGER = 'com.amazon.alexa.behaviors.model.Trigger';
const T_UTTERANCE = 'com.amazon.alexa.behaviors.model.CustomUtteranceTriggerPayload';
const T_SEQUENCE = 'com.amazon.alexa.behaviors.model.Sequence';
const T_OP_NODE = 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode';

const USAGE = `usage: alexa-cli <command>

Account
  login                         connect to Amazon (local login page on http://127.0.0.1:${PROXY_PORT}/)
  logout                        forget the stored tokens

Smart home
  devices [text]                devices routines can target (name, id)
  appliances [text] [--offline] devices with their source (Matter, skill) and reachability
  skills [text]                 enabled skills and the smart-home devices each one provides
  forget <device> [--force] --apply
                                delete a device from Alexa; refused while a routine uses it (--force overrides)

Routines (<routine> = name, phrase or id)
  routines [text]               list, optionally filtered by name or phrase
  show <routine>                full JSON
  create --phrase "<what you say>" [--phrase "<another way>"...] --device "<device>"
         [--op turnOn|turnOff] [--name "<name>"] [--apply]
                                voice routine that turns a device on (default) or off
  phrases <routine> [--add "<phrase>"...] [--remove "<phrase>"...] [--apply]
                                add or remove the ways to say a routine
  retarget <routine> --device "<device>" [--from "<device>"] [--op turnOn|turnOff] [--apply]
                                point a routine at another device (same id, phrases and name); --from picks
                                which device to replace when the routine controls several
  enable <routine> [--apply] / disable <routine> [--apply]
  run <routine> [--on "<echo name>"]
                                run a routine now, as if it had been said to that Echo
  delete <routine> --apply
  audit                         routines whose target device no longer exists
  snapshot                      routines, devices, appliances, skills and audit over one connection, as JSON
                                lines ({"kind", "data"}) printed as each part is ready

  Without --apply, commands that change something only print what they would do.
  --json                        raw JSON output (devices, appliances, skills, routines, audit)`;

const REPEATED = new Set(['phrase', 'add', 'remove']);
const FLAGS = new Set(['apply', 'json', 'force', 'offline']);

function parseArgs(argv) {
    const args = { _: [], phrase: [], add: [], remove: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const key = a.slice(2);
        if (!a.startsWith('--')) args._.push(a);
        else if (FLAGS.has(key)) args[key] = true;
        else if (REPEATED.has(key)) args[key].push(argv[++i]);
        else args[key] = argv[++i];
    }
    return args;
}

function loadAuth() {
    try {
        return JSON.parse(fs.readFileSync(AUTH, 'utf8'));
    } catch {
        return null;
    }
}

function saveAuth(data) {
    fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(AUTH, JSON.stringify(data), { mode: 0o600 });
    fs.chmodSync(AUTH, 0o600);
}

function connect({ interactive }) {
    const former = loadAuth();
    if (!former && !interactive) {
        return Promise.reject(new Error('not logged in: run "alexa-cli login" first'));
    }
    const alexa = new Alexa();
    return new Promise((resolve, reject) => {
        alexa.on('cookie', () => {
            if (alexa.cookieData) saveAuth(alexa.cookieData);
        });
        alexa.init({
            cookie: former || undefined,
            formerRegistrationData: former || undefined,
            amazonPage: 'amazon.fr',
            alexaServiceHost: 'alexa.amazon.fr',
            acceptLanguage: LOCALE,
            amazonPageProxyLanguage: 'fr_FR',
            setupProxy: true,
            proxyOwnIp: '127.0.0.1',
            proxyPort: PROXY_PORT,
            proxyListenBind: '127.0.0.1',
            useWsMqtt: false,
            usePushConnection: false,
            notifications: false,
            bluetooth: false,
            cookieRefreshInterval: 0,
            logger: process.env.ALEXA_CLI_DEBUG ? (m) => console.error(String(m).slice(0, 300)) : undefined,
        }, (err) => {
            if (err) {
                const msg = String(err.message || err);
                if (interactive && msg.includes(`:${PROXY_PORT}`)) {
                    console.error(`Open http://127.0.0.1:${PROXY_PORT}/ in your browser and sign in to Amazon.`);
                    console.error('Waiting for the login to finish...');
                    return;
                }
                return reject(err);
            }
            if (alexa.cookieData) saveAuth(alexa.cookieData);
            resolve(alexa);
        });
    });
}

function call(alexa, apiPath, flags = {}) {
    return new Promise((resolve, reject) => {
        alexa.httpsGet(apiPath, (err, res) => (err ? reject(err) : resolve(res)), { timeout: 30000, ...flags });
    });
}

function viaCallback(fn) {
    return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))));
}

// JSON with every non-ASCII character as a \u escape. alexa-remote2 writes the body without a charset, and
// Amazon then stored "télé" as "tÃ©lÃ©"; escaped, the text reaches it intact whatever the encoding.
function asciiJson(value) {
    return JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// ---- smart home -------------------------------------------------------------------------------------------

async function smartHomeDevices(alexa) {
    const res = await call(alexa, '/api/behaviors/entities?skillId=amzn1.ask.1p.smarthome');
    return Array.isArray(res) ? res : [];
}

// Every appliance in the nested /api/phoenix answer, wherever it sits.
async function appliances(alexa) {
    const found = new Map();
    const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        if (n.applianceId && n.friendlyName) found.set(n.applianceId, n);
        Object.values(n).forEach(walk);
    };
    walk(await viaCallback((cb) => alexa.getSmarthomeDevices(cb)));
    return [...found.values()];
}

// The skill behind a skill-provided appliance: driverIdentity.identifier is base64 JSON {"skillId", "stage"}.
function skillIdOf(appliance) {
    const id = appliance.driverIdentity;
    if (!id || id.namespace !== 'SKILL' || !id.identifier) return null;
    try {
        return JSON.parse(Buffer.from(id.identifier, 'base64').toString('utf8')).skillId || null;
    } catch {
        return null;
    }
}

// Enabled skills (Amazon's "your skills" page) merged with the skills that provide smart-home devices: the page
// leaves most smart-home skills out (TCL, Smart Life, Tapo), the devices name them.
async function skills(alexa, knownAppliances) {
    const byId = new Map();
    const [listed, apps] = await Promise.all([
        viaCallback((cb) => alexa.getSkills(cb)).catch(() => []),
        knownAppliances || appliances(alexa),
    ]);
    for (const s of listed || []) byId.set(s.id, { id: s.id, name: s.name, type: s.type, enabled: true, devices: [] });
    for (const a of await apps) {
        const id = skillIdOf(a);
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, { id, name: null, type: 'SMART_HOME', enabled: null, devices: [] });
        const s = byId.get(id);
        s.name = s.name || a.manufacturerName || null;
        s.devices.push({ name: deviceName(a), applianceId: a.applianceId });
    }
    return [...byId.values()];
}

function deviceName(d) {
    return d.displayName || d.friendlyName || d.name || '';
}

function deviceIds(d) {
    return [d.id, d.entityId, d.applianceId, d.endpointId].filter(Boolean);
}

function findByName(list, key, what) {
    const k = key.toLowerCase();
    const hits = list.filter((d) => deviceName(d).toLowerCase() === k || deviceIds(d).includes(key));
    if (hits.length === 1) return hits[0];
    if (hits.length === 0) throw new Error(`no ${what} is named "${key}"`);
    throw new Error(`${hits.length} ${what}s are named "${key}"; use the id`);
}

// ---- routines ---------------------------------------------------------------------------------------------

async function routines(alexa) {
    const res = await call(alexa, '/api/behaviors/v2/automations?limit=2000');
    return Array.isArray(res) ? res : [];
}

function phrasesOf(routine) {
    return (routine.triggers || []).flatMap((t) => (t.payload && (t.payload.utterances || [t.payload.utterance])) || [])
        .filter(Boolean);
}

function routineLabel(r) {
    return r.name || phrasesOf(r).join(' / ') || '(sans nom)';
}

function findRoutine(list, key) {
    const k = key.toLowerCase();
    const hits = list.filter((r) => r.automationId === key
        || (r.name || '').toLowerCase() === k
        || phrasesOf(r).some((p) => p.toLowerCase() === k));
    if (hits.length === 1) return hits[0];
    if (hits.length === 0) throw new Error(`no routine matches "${key}"`);
    throw new Error(`"${key}" matches ${hits.length} routines; use the id`);
}

// Device targets of a routine's actions (placeholders such as ALEXA_CURRENT_DEVICE or virtual@LIGHT@…, "all the
// lights", are left out).
function routineTargets(routine) {
    const out = [];
    const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        if (String(n['@type'] || '').endsWith('OperationNode') && n.operationPayload) {
            const p = typeof n.operationPayload === 'string' ? JSON.parse(n.operationPayload) : n.operationPayload;
            if (p.target && !/^ALEXA_|CURRENT|^amzn1\.|^virtual@/i.test(p.target)) {
                out.push({ target: p.target, op: (p.operations || []).map((o) => o.type).join(',') || n.type });
            }
        }
        Object.values(n).forEach(walk);
    };
    walk(routine.sequence);
    return out;
}

async function validated(alexa, type, operationPayload) {
    const res = await call(alexa, '/api/behaviors/operation/validate', {
        method: 'POST',
        headers: WRITE_HEADERS,
        data: asciiJson({ type, operationPayload: JSON.stringify(operationPayload) }),
    });
    if (res && res.result && res.result !== 'VALID') throw new Error(`Alexa rejected the ${type} action: ${JSON.stringify(res)}`);
    // Smart-home actions come back VALID without a normalised payload: the one sent is then used as is.
    let normalised = res && res.operationPayload;
    if (typeof normalised === 'string') normalised = JSON.parse(normalised);
    return normalised || operationPayload;
}

// The Alexa app's write format: a flat body whose trigger and sequence are JSON strings, the trigger payload a
// JSON string inside that, every action normalised by /operation/validate. Bad input still answers HTTP 200
// with {"message":"Input failed to validate."}, so the answer is checked, not the status.
function writeBody({ name, status, triggers, sequence, behaviorId }) {
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

function utteranceTrigger(phrases, customerId) {
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

async function smartHomeSequence(alexa, { target, op, customerId }) {
    const operationPayload = await validated(alexa, 'Alexa.SmartHome.Batch',
        { target, customerId, operations: [{ type: op }], locale: LOCALE });
    return {
        '@type': T_SEQUENCE,
        startNode: { '@type': T_OP_NODE, type: 'Alexa.SmartHome.Batch', skillId: 'amzn1.ask.1p.smarthome', operationPayload, context: null },
    };
}

// Rebuild a saved routine in write form, with `edit` applied to its decoded trigger payloads and action
// payloads; every action is re-validated, as the app does (alexa-mcp setRoutineEnabled).
async function rebuild(alexa, routine, { status, editTrigger, editAction } = {}) {
    const triggers = (routine.triggers || []).map((t) => {
        const payload = JSON.parse(JSON.stringify(t.payload));
        if (editTrigger) editTrigger(payload, t);
        return { '@type': T_TRIGGER, id: null, skillId: t.skillId || null, type: t.type, payload: JSON.stringify(payload) };
    });
    if (!triggers.length) throw new Error('the routine has no trigger');
    const node = async (n) => {
        if (!n || typeof n !== 'object') return n;
        if (String(n['@type'] || '').endsWith('OpaquePayloadOperationNode')) {
            let p = typeof n.operationPayload === 'string' ? JSON.parse(n.operationPayload) : { ...(n.operationPayload || {}) };
            if (editAction) p = editAction(p, n) || p;
            return { '@type': n['@type'], type: n.type, skillId: n.skillId || null, operationPayload: await validated(alexa, n.type, p), context: null };
        }
        if (Array.isArray(n.nodesToExecute)) return { '@type': n['@type'], nodesToExecute: await Promise.all(n.nodesToExecute.map(node)) };
        return n;
    };
    const sequence = { '@type': T_SEQUENCE, startNode: await node(routine.sequence && routine.sequence.startNode) };
    return writeBody({ name: routine.name, status: status || routine.status, triggers, sequence, behaviorId: routine.automationId });
}

async function putRoutine(alexa, body) {
    const res = await call(alexa, `/api/behaviors/automations/${encodeURIComponent(body.behaviorId)}`,
        { method: 'PUT', headers: WRITE_HEADERS, data: asciiJson(body) });
    if (res && res.message) throw new Error(`Alexa did not update the routine: ${res.message}`);
}

async function postRoutine(alexa, body) {
    // Never retried: a lost answer to a create that went through would duplicate the routine.
    const res = await call(alexa, '/api/behaviors/automations', { method: 'POST', headers: WRITE_HEADERS, data: asciiJson(body) });
    if (!res || !res.automationId) throw new Error(`Alexa did not create the routine: ${JSON.stringify(res)}`);
    return res;
}

function customerIdOf(list) {
    for (const r of list) {
        if (r.owner && r.owner.id) return r.owner.id;
        const t = (r.triggers || []).find((x) => x.payload && x.payload.customerId);
        if (t) return t.payload.customerId;
    }
    throw new Error('could not find the Amazon customer id in the existing routines');
}

function checkPhrasesFree(list, phrases, except) {
    const lower = phrases.map((p) => p.toLowerCase());
    const taken = list.filter((r) => r !== except && phrasesOf(r).some((p) => lower.includes(p.toLowerCase())));
    if (taken.length) throw new Error(`phrase already used by: ${taken.map(routineLabel).join(', ')}`);
}

const quote = (list) => list.map((p) => `"${p}"`).join(', ');

// ---- commands ---------------------------------------------------------------------------------------------

const commands = {
    async login() {
        console.log(`logged in; tokens stored in ${AUTH}`);
    },

    async devices(alexa, args) {
        const list = (await smartHomeDevices(alexa))
            .filter((d) => !args._[1] || deviceName(d).toLowerCase().includes(args._[1].toLowerCase()));
        if (args.json) return console.log(JSON.stringify(list, null, 2));
        list.forEach((d) => console.log(`${deviceName(d)}\t${deviceIds(d)[0]}`));
    },

    async appliances(alexa, args) {
        const list = (await appliances(alexa))
            .filter((a) => !args._[1] || deviceName(a).toLowerCase().includes(args._[1].toLowerCase()))
            .filter((a) => !args.offline || (a.applianceNetworkState && a.applianceNetworkState.reachability) === 'NOT_REACHABLE');
        if (args.json) return console.log(JSON.stringify(list, null, 2));
        list.forEach((a) => console.log([deviceName(a), a.manufacturerName || '', String(a.applianceId).split('_')[0],
            (a.applianceNetworkState && a.applianceNetworkState.reachability) || '', a.applianceId].join('\t')));
    },

    async forget(alexa, args) {
        const dev = findByName(await appliances(alexa), args._[1] || '', 'device');
        const ids = new Set(deviceIds(dev));
        const using = (await routines(alexa)).filter((r) => routineTargets(r).some((t) => ids.has(t.target)));
        console.log(`forget "${deviceName(dev)}" (${dev.manufacturerName || '?'}, ${dev.applianceId})`);
        if (using.length && !args.force) {
            throw new Error(`still used by ${using.length} routine(s): ${using.map(routineLabel).join(', ')} (--force to delete anyway)`);
        }
        if (!args.apply) return console.log('(dry run: add --apply to do it)');
        // The id holds # / = and must be encoded, or the DELETE silently does nothing (alexa-mcp).
        await call(alexa, `/api/phoenix/appliance/${encodeURIComponent(dev.applianceId)}`, { method: 'DELETE' });
        const still = (await appliances(alexa)).some((a) => a.applianceId === dev.applianceId);
        if (still) throw new Error('Alexa still lists the device');
        console.log('deleted');
    },

    async skills(alexa, args) {
        const list = (await skills(alexa))
            .filter((s) => !args._[1] || [s.name || '', s.id, ...s.devices.map((d) => d.name)]
                .some((x) => x.toLowerCase().includes(args._[1].toLowerCase())))
            .sort((a, b) => b.devices.length - a.devices.length || String(a.name).localeCompare(String(b.name)));
        if (args.json) return console.log(JSON.stringify(list, null, 2));
        for (const s of list) {
            console.log(`${s.name || '(sans nom)'}\t${s.type || ''}\t${s.devices.length} appareil(s)\t${s.id}`);
            s.devices.forEach((d) => console.log(`  - ${d.name}`));
        }
    },

    async routines(alexa, args) {
        const list = (await routines(alexa))
            .filter((r) => !args._[1] || [routineLabel(r), ...phrasesOf(r)].some((s) => s.toLowerCase().includes(args._[1].toLowerCase())));
        if (args.json) return console.log(JSON.stringify(list, null, 2));
        list.forEach((r) => console.log(`${r.status === 'ENABLED' ? '●' : '○'} ${routineLabel(r)}\t${r.automationId}`));
    },

    async show(alexa, args) {
        console.log(JSON.stringify(findRoutine(await routines(alexa), args._[1] || ''), null, 2));
    },

    async create(alexa, args) {
        const op = args.op || 'turnOn';
        if (!['turnOn', 'turnOff'].includes(op)) throw new Error('--op is turnOn or turnOff');
        if (!args.phrase.length) throw new Error('create needs at least one --phrase');
        if (!args.device) throw new Error('create needs --device');
        const list = await routines(alexa);
        const device = findByName(await smartHomeDevices(alexa), args.device, 'device');
        checkPhrasesFree(list, args.phrase);
        const name = args.name || args.phrase[0];
        console.log(`create "${name}": ${quote(args.phrase)} -> ${op} ${deviceName(device)}`);
        if (!args.apply) return console.log('(dry run: add --apply to do it)');
        const customerId = customerIdOf(list);
        const body = writeBody({
            name,
            status: 'ENABLED',
            triggers: [utteranceTrigger(args.phrase, customerId)],
            sequence: await smartHomeSequence(alexa, { target: deviceIds(device)[0], op, customerId }),
        });
        console.log(`created ${(await postRoutine(alexa, body)).automationId}`);
    },

    async phrases(alexa, args) {
        const list = await routines(alexa);
        const r = findRoutine(list, args._[1] || '');
        const current = phrasesOf(r);
        const drop = args.remove.map((p) => p.toLowerCase());
        const next = [...current.filter((p) => !drop.includes(p.toLowerCase())),
            ...args.add.filter((p) => !current.some((c) => c.toLowerCase() === p.toLowerCase()))];
        if (!next.length) throw new Error('a routine needs at least one phrase');
        checkPhrasesFree(list, args.add, r);
        console.log(`"${routineLabel(r)}": ${quote(next)}`);
        if (!args.apply) return console.log('(dry run: add --apply to do it)');
        if ((r.triggers || []).filter((t) => t.type === 'CustomUtterance').length !== 1) {
            throw new Error('only routines with one voice trigger can be edited');
        }
        await putRoutine(alexa, await rebuild(alexa, r, {
            editTrigger: (p, t) => {
                if (t.type !== 'CustomUtterance') return;
                p.utterance = next[0];
                p.utterances = next;
            },
        }));
        const after = findRoutine(await routines(alexa), r.automationId);
        console.log(`updated: ${quote(phrasesOf(after))}`);
    },

    async retarget(alexa, args) {
        if (!args.device) throw new Error('retarget needs --device');
        if (args.op && !['turnOn', 'turnOff'].includes(args.op)) throw new Error('--op is turnOn or turnOff');
        const r = findRoutine(await routines(alexa), args._[1] || '');
        const devices = await smartHomeDevices(alexa);
        let targets = routineTargets(r);
        if (args.from) {
            // The same device is listed twice (as a routine entity and as an appliance): take every id of the name.
            const k = args.from.toLowerCase();
            const from = new Set([...devices, ...await appliances(alexa)]
                .filter((d) => deviceName(d).toLowerCase() === k || deviceIds(d).includes(args.from))
                .flatMap(deviceIds));
            if (!from.size) throw new Error(`no device is named "${args.from}"`);
            targets = targets.filter((t) => from.has(t.target));
        }
        if (targets.length !== 1) {
            throw new Error(`retarget needs exactly one matching device action (found ${targets.length}); `
                + 'name the device to replace with --from');
        }
        const device = findByName(devices, args.device, 'device');
        const to = deviceIds(device)[0];
        console.log(`"${routineLabel(r)}": ${targets[0].op} ${targets[0].target} -> ${args.op || targets[0].op} ${deviceName(device)}`);
        if (!args.apply) return console.log('(dry run: add --apply to do it)');
        await putRoutine(alexa, await rebuild(alexa, r, {
            editAction: (p) => {
                if (p.target !== targets[0].target) return p;
                return { ...p, target: to, ...(args.op ? { operations: [{ type: args.op }] } : {}) };
            },
        }));
        const after = routineTargets(findRoutine(await routines(alexa), r.automationId));
        console.log(`updated: ${after.map((t) => `${t.op} ${t.target}`).join(', ')}`);
    },

    async enable(alexa, args) {
        return setStatus(alexa, args, 'ENABLED');
    },

    async disable(alexa, args) {
        return setStatus(alexa, args, 'DISABLED');
    },

    async run(alexa, args) {
        const r = findRoutine(await routines(alexa), args._[1] || '');
        const echos = ((await viaCallback((cb) => alexa.getDevices(cb))) || {}).devices || [];
        const echo = args.on
            ? findByName(echos.map((d) => ({ ...d, displayName: d.accountName, id: d.serialNumber })), args.on, 'Echo')
            : echos.find((d) => d.deviceFamily === 'ECHO') || echos[0];
        if (!echo) throw new Error('no Echo found to run the routine on');
        await viaCallback((cb) => alexa.executeAutomationRoutine(echo.serialNumber, r, cb));
        console.log(`ran "${routineLabel(r)}" on ${echo.accountName}`);
    },

    async delete(alexa, args) {
        const r = findRoutine(await routines(alexa), args._[1] || '');
        console.log(`delete "${routineLabel(r)}" ${r.automationId}`);
        if (!args.apply) return console.log('(dry run: add --apply to do it)');
        await call(alexa, `/api/behaviors/automations/${encodeURIComponent(r.automationId)}`, { method: 'DELETE' });
        console.log('deleted');
    },

    async audit(alexa, args) {
        const broken = brokenRoutines(...await Promise.all([routines(alexa), smartHomeDevices(alexa), appliances(alexa)]));
        if (args.json) return console.log(JSON.stringify(broken, null, 2));
        for (const r of broken) {
            console.log(`${r.name}\t${r.automationId}\n  missing: ${r.missing.map((t) => `${t.op} ${t.name || t.target}`).join(', ')}`);
        }
        console.log(broken.length ? `${broken.length} routine(s) point at devices that no longer exist` : 'no broken routine');
    },

    // Everything the interface shows, over one connection, one JSON line per part as soon as it is ready:
    // routines first (the main view), the audit last, computed from what was already fetched.
    async snapshot(alexa) {
        const emit = (kind, data) => process.stdout.write(`${JSON.stringify({ kind, data })}\n`);
        const fail = (kind) => (e) => {
            emit('error', { kind, message: e.message || String(e) });
            return null;
        };
        const list = routines(alexa).then((d) => (emit('routines', d), d), fail('routines'));
        const devs = smartHomeDevices(alexa).then((d) => (emit('devices', d), d), fail('devices'));
        const apps = appliances(alexa).then((d) => (emit('appliances', d), d), fail('appliances'));
        const done = [
            skills(alexa, apps.then((a) => a || [])).then((d) => emit('skills', d), fail('skills')),
            Promise.all([list, devs, apps]).then(([l, d, a]) => {
                if (l && d && a) emit('audit', brokenRoutines(l, d, a));
            }),
        ];
        await Promise.all(done);
    },
};

function brokenRoutines(list, devs, apps) {
    const known = new Set([...devs, ...apps].flatMap(deviceIds));
    const names = new Map([...devs, ...apps].flatMap((d) => deviceIds(d).map((id) => [id, deviceName(d)])));
    return list
        .map((r) => ({ name: routineLabel(r), automationId: r.automationId,
            missing: routineTargets(r).filter((t) => !known.has(t.target))
                .map((t) => ({ ...t, name: names.get(t.target) || null })) }))
        .filter((r) => r.missing.length);
}

async function setStatus(alexa, args, status) {
    const r = findRoutine(await routines(alexa), args._[1] || '');
    console.log(`"${routineLabel(r)}": ${r.status} -> ${status}`);
    if (r.status === status) return;
    if (!args.apply) return console.log('(dry run: add --apply to do it)');
    await putRoutine(alexa, await rebuild(alexa, r, { status }));
    console.log(`now ${findRoutine(await routines(alexa), r.automationId).status}`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];
    if (!cmd || cmd === 'help' || args.help) return console.log(USAGE);
    if (cmd === 'logout') {
        fs.rmSync(AUTH, { force: true });
        return console.log('tokens removed');
    }
    if (!Object.hasOwn(commands, cmd)) {
        console.log(USAGE);
        process.exitCode = 2;
        return;
    }
    const alexa = await connect({ interactive: cmd === 'login' });
    await commands[cmd](alexa, args);
}

// alexa-remote2 keeps sockets open, so the process is ended by hand, once stdout has been flushed:
// exiting straight away cut piped output (a long --json) at 64 KB.
const exit = (code) => process.stdout.write('', () => process.exit(code));

main()
    .then(() => exit(process.exitCode || 0))
    .catch((e) => {
        console.error(`error: ${e.message || e}`);
        exit(1);
    });

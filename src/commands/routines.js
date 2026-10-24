// Routines: list, read, export as a spec, create or replace from a spec, edit (phrases, device, on/off), run and
// delete.
// Every edit is a full rebuild of the routine and a PUT — the app has no partial update — so a routine keeps its
// id, its other actions and its other phrases.

import fs from 'node:fs';
import { APPLY, UsageError } from '../args.js';
import { act } from '../context.js';
import {
    OPERATIONS, checkPhrasesFree, customerIdOf, deviceIds, deviceName, editedPhrases, findByName, findRoutine, idsOfName,
    phrasesOf, rebuildBody, routineLabel, routineTargets,
} from '../model.js';
import { SpecError, checkSpec, flatSteps, fromSpec, specHasGroups, specPhrases, toSpec, writeSpecBody } from '../routine-spec.js';

const ROUTINE = { name: 'routine', required: true, help: 'Routine name, one of its phrases, or its id' };
const quote = (list) => list.map((p) => `"${p}"`).join(', ');
const summary = (r) => ({ name: routineLabel(r), automationId: r.automationId, status: r.status, phrases: phrasesOf(r) });

async function routineAndClient(ctx, key) {
    const client = await ctx.client();
    const all = await client.routines();
    return { client, all, routine: findRoutine(all, key) };
}

const validator = (client) => (type, payload) => client.validate(type, payload);

const routines = {
    name: 'routines',
    group: 'Routines',
    summary: 'List routines',
    args: [{ name: 'text', help: 'Only routines whose name or phrases contain this text' }],
    modes: ['json', 'plain'],
    async run(ctx, { args }) {
        const q = (args.text || '').toLowerCase();
        const list = (await (await ctx.client()).routines())
            .filter((r) => !q || [routineLabel(r), ...phrasesOf(r)].some((s) => s.toLowerCase().includes(q)));
        ctx.out.list(list, [
            { title: '', value: (r) => r.status, human: (r) => (r.status === 'ENABLED' ? ctx.out.style.green('●') : ctx.out.style.dim('○')) },
            { title: 'NAME', value: routineLabel },
            { title: 'PHRASES', value: phrasesOf, human: (r) => String(phrasesOf(r).length) },
            { title: 'ID', value: (r) => r.automationId, human: (r) => ctx.out.style.dim(r.automationId) },
        ], { empty: 'no routine' });
    },
};

const show = {
    name: 'show',
    group: 'Routines',
    summary: 'The full JSON of one routine',
    args: [ROUTINE],
    modes: ['json'],
    async run(ctx, { args }) {
        const { routine } = await routineAndClient(ctx, args.routine);
        ctx.out.document(routine);
    },
};

// A spec from --from FILE ("-" reads stdin) or --spec JSON (what the web interface sends).
function readSpec(opts) {
    if (opts.from && opts.spec) throw new UsageError('give --from or --spec, not both');
    let text;
    try {
        text = opts.spec !== undefined ? opts.spec : fs.readFileSync(opts.from === '-' ? 0 : opts.from, 'utf8');
    } catch (e) {
        throw new Error(`cannot read ${opts.from}: ${e.message}`);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new SpecError(`the spec is not valid JSON: ${e.message}`);
    }
}

const STEP_WORDS = { on: 'allumer', off: 'éteindre' };

/** One line per step, indented by nesting: what the dry run shows before a spec is written. */
export function describeSpec(spec) {
    const when = spec.when.say !== undefined ? `when said: ${quote([].concat(spec.when.say))}`
        : spec.when.at !== undefined ? `at ${spec.when.at}${spec.when.days ? ` on ${spec.when.days.join(',')}` : ' every day'}` : 'when: (kept as is)';
    const lines = [];
    const walk = (steps, depth) => steps.forEach((s) => {
        const pad = '  '.repeat(depth);
        const on = s.on ? ` (on ${s.on})` : '';
        if (s.device !== undefined) return lines.push(`${pad}- turn ${s.turn} ${s.device}`);
        if (s.say !== undefined) return lines.push(`${pad}- say "${s.say}"${on}`);
        if (s.wait !== undefined) return lines.push(`${pad}- wait ${s.wait}s`);
        if (s.play !== undefined) return lines.push(`${pad}- play ${s.play}${on}`);
        if (s.command !== undefined) return lines.push(`${pad}- tell Alexa "${s.command}"${on}`);
        if (s.fireTv !== undefined) return lines.push(`${pad}- turn off Fire TV${on}`);
        return lines.push(`${pad}- ${s.raw.type} (kept as is)`);
    });
    walk(flatSteps(spec.do), 1);
    if (specHasGroups(spec)) lines.push('  (groups flattened: Amazon runs actions in order, each run of device actions together with the next one)');
    return [`"${spec.name || [].concat(spec.when.say || [])[0] || 'routine'}" ${spec.enabled === false ? '(disabled) ' : ''}${when}`, ...lines].join('\n');
}

async function writeSpec(ctx, { spec, existing = null }) {
    checkSpec(spec);
    const client = await ctx.client();
    const [all, entities, echos] = await Promise.all([client.routines(), client.entities(), client.echos()]);
    checkPhrasesFree(all, specPhrases(spec), existing ? all.find((r) => r.automationId === existing.automationId) : null);
    const routine = fromSpec(spec, { devices: entities, echos, customerId: customerIdOf(all) });
    await act(ctx, {
        plan: `${existing ? `update "${routineLabel(existing)}"` : 'create'} ${describeSpec(spec)}`,
        details: { spec, ...(existing ? { automationId: existing.automationId } : {}) },
        run: async () => {
            const body = await writeSpecBody(routine, validator(client), existing && existing.automationId);
            if (existing) {
                await client.updateRoutine(body);
                return `updated ${existing.automationId}`;
            }
            return `created ${(await client.createRoutine(body)).automationId}`;
        },
    });
}

const SPEC_OPTIONS = [
    { name: 'from', type: 'string', metavar: 'FILE', help: 'The routine as a JSON spec ("-": stdin; see "export")' },
    { name: 'spec', type: 'string', metavar: 'JSON', help: 'The same spec, inline' },
];

const create = {
    name: 'create',
    group: 'Routines',
    summary: 'Create a routine: from a spec, or a phrase that turns a device on or off',
    description: 'A spec chains actions, in order or together, on a phrase or a schedule — see the README.\n'
        + 'Quick form: --phrase "…" --device "…" [--op turnOff].',
    options: [
        ...SPEC_OPTIONS,
        { name: 'phrase', type: 'list', metavar: 'TEXT', help: 'What you say (repeat for other ways to say it)' },
        { name: 'device', type: 'string', metavar: 'NAME', help: 'Device to control (see "devices")' },
        { name: 'op', type: 'choice', choices: OPERATIONS, help: 'turnOn (default) or turnOff' },
        { name: 'name', type: 'string', help: 'Routine name (default: the first phrase)' },
        APPLY,
    ],
    modes: ['json'],
    async run(ctx, { opts }) {
        if (opts.from !== undefined || opts.spec !== undefined) {
            if (opts.phrase.length || opts.device) throw new UsageError('give a spec or --phrase/--device, not both');
            return writeSpec(ctx, { spec: readSpec(opts) });
        }
        if (!opts.phrase.length) throw new Error('create needs --from, --spec or at least one --phrase');
        if (!opts.device) throw new Error('create needs --device');
        const turn = (opts.op || 'turnOn') === 'turnOn' ? 'on' : 'off';
        return writeSpec(ctx, { spec: { name: opts.name || opts.phrase[0], when: { say: opts.phrase }, do: [{ device: opts.device, turn }] } });
    },
};

const update = {
    name: 'update',
    group: 'Routines',
    summary: 'Replace a routine with a spec, keeping its id',
    args: [ROUTINE],
    options: [...SPEC_OPTIONS, APPLY],
    modes: ['json'],
    async run(ctx, { args, opts }) {
        if (opts.from === undefined && opts.spec === undefined) throw new UsageError('update needs --from or --spec');
        const { routine } = await routineAndClient(ctx, args.routine);
        return writeSpec(ctx, { spec: readSpec(opts), existing: routine });
    },
};

const exportRoutine = {
    name: 'export',
    group: 'Routines',
    summary: 'A routine as an editable JSON spec (for create/update --from)',
    args: [ROUTINE],
    async run(ctx, { args }) {
        const { client, routine } = await routineAndClient(ctx, args.routine);
        const [entities, appliances, echos] = await Promise.all([client.entities(), client.appliances(), client.echos()]);
        ctx.stdout.write(`${JSON.stringify(toSpec(routine, { devices: [...entities, ...appliances], echos }), null, 2)}\n`);
    },
};

const phrases = {
    name: 'phrases',
    group: 'Routines',
    summary: 'Add or remove ways to say a routine',
    args: [ROUTINE],
    options: [
        { name: 'add', type: 'list', metavar: 'TEXT', help: 'Phrase to add (repeatable)' },
        { name: 'remove', type: 'list', metavar: 'TEXT', help: 'Phrase to remove (repeatable)' },
        APPLY,
    ],
    modes: ['json'],
    async run(ctx, { args, opts }) {
        const { client, all, routine } = await routineAndClient(ctx, args.routine);
        const next = editedPhrases(phrasesOf(routine), opts);
        if (!next.length) throw new Error('a routine needs at least one phrase');
        checkPhrasesFree(all, opts.add, routine);
        if ((routine.triggers || []).filter((t) => t.type === 'CustomUtterance').length !== 1) {
            throw new Error('only routines with one voice trigger can be edited');
        }
        await act(ctx, {
            plan: `"${routineLabel(routine)}": ${quote(next)}`,
            details: { routine: { ...summary(routine), phrases: next } },
            run: async () => {
                await client.updateRoutine(await rebuildBody(routine, {
                    editTrigger: (p, t) => {
                        if (t.type !== 'CustomUtterance') return;
                        p.utterance = next[0];
                        p.utterances = next;
                    },
                }, validator(client)));
                return `phrases now: ${quote(phrasesOf(findRoutine(await client.routines(), routine.automationId)))}`;
            },
        });
    },
};

const retarget = {
    name: 'retarget',
    group: 'Routines',
    summary: 'Point a routine at another device (same id, phrases and name)',
    args: [ROUTINE],
    options: [
        { name: 'device', type: 'string', metavar: 'NAME', help: 'The new device' },
        { name: 'from', type: 'string', metavar: 'NAME', help: 'Which device to replace, when the routine controls several' },
        { name: 'op', type: 'choice', choices: OPERATIONS, help: 'Change the operation too' },
        APPLY,
    ],
    modes: ['json'],
    async run(ctx, { args, opts }) {
        if (!opts.device) throw new Error('retarget needs --device');
        const { client, routine } = await routineAndClient(ctx, args.routine);
        const entities = await client.entities();
        let targets = routineTargets(routine);
        if (opts.from) {
            const from = idsOfName([entities, await client.appliances()], opts.from);
            if (!from.size) throw new Error(`no device is named "${opts.from}"`);
            targets = targets.filter((t) => from.has(t.target));
        }
        if (targets.length !== 1) {
            throw new Error(`retarget needs exactly one matching device action (found ${targets.length}); name the device to replace with --from`);
        }
        const device = findByName(entities, opts.device);
        const to = deviceIds(device)[0];
        const [old] = targets;
        await act(ctx, {
            plan: `"${routineLabel(routine)}": ${old.op} ${old.target} -> ${opts.op || old.op} ${deviceName(device)}`,
            details: { routine: summary(routine), from: old.target, to },
            run: async () => {
                await client.updateRoutine(await rebuildBody(routine, {
                    editAction: (p) => (p.target !== old.target ? p : { ...p, target: to, ...(opts.op ? { operations: [{ type: opts.op }] } : {}) }),
                }, validator(client)));
                const after = routineTargets(findRoutine(await client.routines(), routine.automationId));
                return `now: ${after.map((t) => `${t.op} ${t.target}`).join(', ')}`;
            },
        });
    },
};

function statusCommand(name, status) {
    return {
        name,
        group: 'Routines',
        summary: `${status === 'ENABLED' ? 'Enable' : 'Disable'} a routine`,
        args: [ROUTINE],
        options: [APPLY],
        modes: ['json'],
        async run(ctx, { args }) {
            const { client, routine } = await routineAndClient(ctx, args.routine);
            if (routine.status === status) {
                return ctx.out.action({ applied: true, plan: `"${routineLabel(routine)}" is already ${status}`, routine: summary(routine) });
            }
            await act(ctx, {
                plan: `"${routineLabel(routine)}": ${routine.status} -> ${status}`,
                details: { routine: { ...summary(routine), status } },
                run: async () => {
                    await client.updateRoutine(await rebuildBody(routine, { status }, validator(client)));
                    return `now ${findRoutine(await client.routines(), routine.automationId).status}`;
                },
            });
        },
    };
}

const run = {
    name: 'run',
    group: 'Routines',
    summary: 'Run a routine now, as if it had been said to an Echo',
    args: [ROUTINE],
    options: [{ name: 'on', type: 'string', metavar: 'ECHO', help: 'Which Echo (default: the first one)' }],
    modes: ['json'],
    async run(ctx, { args, opts }) {
        const { client, routine } = await routineAndClient(ctx, args.routine);
        const echos = await client.echos();
        const echo = opts.on
            ? findByName(echos.map((d) => ({ ...d, displayName: d.accountName, id: d.serialNumber })), opts.on, 'Echo')
            : echos.find((d) => d.deviceFamily === 'ECHO') || echos[0];
        if (!echo) throw new Error('no Echo found to run the routine on');
        await client.runRoutine(echo.serialNumber, routine);
        ctx.out.action({ applied: true, plan: `run "${routineLabel(routine)}" on ${echo.accountName}`, message: 'done', routine: summary(routine) });
    },
};

const remove = {
    name: 'delete',
    group: 'Routines',
    summary: 'Delete a routine',
    args: [ROUTINE],
    options: [APPLY],
    modes: ['json'],
    async run(ctx, { args }) {
        const { client, routine } = await routineAndClient(ctx, args.routine);
        await act(ctx, {
            plan: `delete "${routineLabel(routine)}" ${routine.automationId}`,
            details: { routine: summary(routine) },
            run: async () => {
                await client.deleteRoutine(routine.automationId);
                return 'deleted';
            },
        });
    },
};

export default [routines, show, exportRoutine, create, update, phrases, retarget, statusCommand('enable', 'ENABLED'), statusCommand('disable', 'DISABLED'), run, remove];

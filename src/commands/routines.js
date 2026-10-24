// Voice routines: list, read, create, edit (phrases, device, on/off), run and delete.
// Every edit is a full rebuild of the routine and a PUT — the app has no partial update — so a routine keeps its
// id, its other actions and its other phrases.

import { APPLY } from '../args.js';
import { act } from '../context.js';
import {
    OPERATIONS, checkPhrasesFree, customerIdOf, deviceIds, deviceName, editedPhrases, findByName, findRoutine, idsOfName,
    phrasesOf, rebuildBody, routineLabel, routineTargets, smartHomeOperation, smartHomeSequence, utteranceTrigger, writeBody,
} from '../model.js';

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

const create = {
    name: 'create',
    group: 'Routines',
    summary: 'Create a voice routine that turns a device on or off',
    options: [
        { name: 'phrase', type: 'list', metavar: 'TEXT', help: 'What you say (repeat for other ways to say it)' },
        { name: 'device', type: 'string', metavar: 'NAME', help: 'Device to control (see "devices")' },
        { name: 'op', type: 'choice', choices: OPERATIONS, help: 'turnOn (default) or turnOff' },
        { name: 'name', type: 'string', help: 'Routine name (default: the first phrase)' },
        APPLY,
    ],
    modes: ['json'],
    async run(ctx, { opts }) {
        if (!opts.phrase.length) throw new Error('create needs at least one --phrase');
        if (!opts.device) throw new Error('create needs --device');
        const op = opts.op || 'turnOn';
        const client = await ctx.client();
        const [all, entities] = await Promise.all([client.routines(), client.entities()]);
        const device = findByName(entities, opts.device);
        checkPhrasesFree(all, opts.phrase);
        const name = opts.name || opts.phrase[0];
        await act(ctx, {
            plan: `create "${name}": ${quote(opts.phrase)} -> ${op} ${deviceName(device)}`,
            details: { routine: { name, phrases: opts.phrase, op, device: deviceName(device) } },
            run: async () => {
                const customerId = customerIdOf(all);
                const operation = await client.validate('Alexa.SmartHome.Batch', smartHomeOperation({ target: deviceIds(device)[0], op, customerId }));
                const res = await client.createRoutine(writeBody({
                    name, status: 'ENABLED', triggers: [utteranceTrigger(opts.phrase, customerId)], sequence: smartHomeSequence(operation),
                }));
                return `created ${res.automationId}`;
            },
        });
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

export default [routines, show, create, phrases, retarget, statusCommand('enable', 'ENABLED'), statusCommand('disable', 'DISABLED'), run, remove];

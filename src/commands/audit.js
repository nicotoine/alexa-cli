// Checks across routines and devices, and the one-connection snapshot the web interface reads.

import { brokenRoutines } from '../model.js';
import { loadSkills } from './skills.js';

const audit = {
    name: 'audit',
    group: 'Checks',
    summary: 'Routines whose device no longer exists',
    modes: ['json', 'plain'],
    async run(ctx) {
        const client = await ctx.client();
        const broken = brokenRoutines(...await Promise.all([client.routines(), client.entities(), client.appliances()]));
        ctx.out.list(broken, [
            { title: 'ROUTINE', value: (r) => r.name },
            { title: 'MISSING', value: (r) => r.missing.map((t) => `${t.op} ${t.name || t.target}`) },
            { title: 'ID', value: (r) => r.automationId, human: (r) => ctx.out.style.dim(r.automationId) },
        ], { empty: 'no broken routine' });
        if (broken.length && ctx.out.mode === 'human') ctx.out.note(`${broken.length} routine(s) point at devices that no longer exist`);
    },
};

/**
 * Everything the interface shows, over one connection, as JSON lines {"kind", "data"} printed as soon as each
 * part is ready: routines first (fastest, and the main view), the audit computed from what was already fetched,
 * skills last (Amazon's skills page is slow). A failed part is a line {"kind": "error"} and the others go on.
 */
const snapshot = {
    name: 'snapshot',
    group: 'Checks',
    summary: 'All lists over one connection, one JSON line per part as it is ready',
    async run(ctx) {
        const emit = (kind, data) => ctx.stdout.write(`${JSON.stringify({ kind, data })}\n`);
        const client = await ctx.client();
        const part = (kind, promise) => promise.then(
            (data) => (emit(kind, data), data),
            (e) => (emit('error', { kind, message: e.message || String(e) }), null),
        );
        const routines = part('routines', client.routines());
        const devices = part('devices', client.entities());
        const appliances = part('appliances', client.appliances());
        // The Echos (and the Alexa app on each phone) an action can be played on: the routine editor needs them.
        const echos = part('echos', client.echos());
        await Promise.all([
            echos,
            part('skills', loadSkills(client, appliances.then((a) => a || []))),
            Promise.all([routines, devices, appliances]).then(([r, d, a]) => r && d && a && emit('audit', brokenRoutines(r, d, a))),
        ]);
    },
};

export default [audit, snapshot];

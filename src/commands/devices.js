// Smart-home devices: the ones routines can target, the full list with sources, and deleting one.

import { APPLY } from '../args.js';
import { act } from '../context.js';
import { applianceSource, deviceIds, deviceName, findByName, routineLabel, routineTargets } from '../model.js';

const matches = (text) => (d) => !text || deviceName(d).toLowerCase().includes(text.toLowerCase());

const devices = {
    name: 'devices',
    group: 'Smart home',
    summary: 'Devices a routine can target (name, id)',
    args: [{ name: 'text', help: 'Only names containing this text' }],
    modes: ['json', 'plain'],
    async run(ctx, { args }) {
        const list = (await (await ctx.client()).entities()).filter(matches(args.text));
        ctx.out.list(list, [
            { title: 'NAME', value: deviceName },
            { title: 'ID', value: (d) => deviceIds(d)[0] },
        ], { empty: 'no device' });
    },
};

const appliances = {
    name: 'appliances',
    group: 'Smart home',
    summary: 'Every device with its source (matter, skill), maker and reachability',
    args: [{ name: 'text', help: 'Only names containing this text' }],
    modes: ['json', 'plain'],
    async run(ctx, { args }) {
        const list = (await (await ctx.client()).appliances()).filter(matches(args.text));
        ctx.out.list(list, [
            { title: 'NAME', value: deviceName },
            { title: 'MAKER', value: (a) => a.manufacturerName || '' },
            { title: 'SOURCE', value: applianceSource },
            { title: 'REACHABILITY', value: (a) => (a.applianceNetworkState && a.applianceNetworkState.reachability) || '' },
            { title: 'ID', value: (a) => a.applianceId, human: (a) => ctx.out.style.dim(a.applianceId) },
        ], { empty: 'no device' });
    },
};

const forget = {
    name: 'forget',
    group: 'Smart home',
    summary: 'Delete a device from Alexa; refused while a routine uses it',
    description: 'A device from a skill that is still linked comes back at the next discovery: unlink the skill too.',
    args: [{ name: 'device', required: true, help: 'Device name or id' }],
    options: [{ name: 'force', type: 'flag', help: 'Delete it even though routines use it (they will break)' }, APPLY],
    modes: ['json'],
    async run(ctx, { args, opts }) {
        const client = await ctx.client();
        const device = findByName(await client.appliances(), args.device);
        const ids = new Set(deviceIds(device));
        const using = (await client.routines()).filter((r) => routineTargets(r).some((t) => ids.has(t.target)));
        if (using.length && !opts.force) {
            throw new Error(`still used by ${using.length} routine(s): ${using.map(routineLabel).join(', ')} (--force to delete anyway)`);
        }
        await act(ctx, {
            plan: `forget "${deviceName(device)}" (${device.manufacturerName || '?'}, ${applianceSource(device)})`,
            details: { device: { name: deviceName(device), applianceId: device.applianceId }, brokenRoutines: using.map(routineLabel) },
            run: async () => {
                await client.deleteAppliance(device.applianceId);
                if ((await client.appliances()).some((a) => a.applianceId === device.applianceId)) {
                    throw new Error('Alexa still lists the device');
                }
                return 'deleted';
            },
        });
    },
};

const POLL_MS = 10000;
const DEFAULT_WAIT_S = 90;

const describeAppliance = (a) => ({
    name: deviceName(a),
    maker: a.manufacturerName || '',
    source: applianceSource(a),
    applianceId: a.applianceId,
});

// Acts at once, like run: it only asks Alexa to look, as saying "discover devices" to an Echo would.
const discover = {
    name: 'discover',
    group: 'Smart home',
    summary: 'Ask Alexa to look for new devices, and say which ones appeared',
    description: 'Alexa searches for about 45 s. The command polls the device list every 10 s and stops once new '
        + 'devices have appeared and the next poll adds none, or when --wait runs out (0: ask and return at once).',
    options: [{ name: 'wait', type: 'string', metavar: 'SECONDS', help: `How long to watch for new devices (default ${DEFAULT_WAIT_S})` }],
    modes: ['json'],
    async run(ctx, { opts }) {
        const wait = opts.wait === undefined ? DEFAULT_WAIT_S : Number(opts.wait);
        if (!Number.isInteger(wait) || wait < 0) throw new Error(`--wait expects a whole number of seconds, got "${opts.wait}"`);
        const client = await ctx.client();
        const known = new Set((await client.appliances()).map((a) => a.applianceId));
        await client.startDiscovery();
        let found = [];
        for (let elapsed = POLL_MS; elapsed <= wait * 1000; elapsed += POLL_MS) {
            await client.pause(POLL_MS);
            const now = (await client.appliances()).filter((a) => !known.has(a.applianceId));
            const settled = found.length > 0 && now.length === found.length;
            found = now;
            ctx.out.note(`${elapsed / 1000} s: ${found.length ? found.map(deviceName).join(', ') : 'nothing new yet'}`);
            if (settled) break;
        }
        const message = wait === 0 ? 'discovery started'
            : found.length ? `${found.length} new device(s): ${found.map(deviceName).join(', ')}` : 'no new device';
        ctx.out.action({ applied: true, plan: 'discover devices', message, found: found.map(describeAppliance) });
    },
};

export default [devices, appliances, discover, forget];

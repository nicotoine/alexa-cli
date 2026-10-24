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

export default [devices, appliances, forget];

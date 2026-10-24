// Skills, and the smart-home devices each one provides — what to watch when a deleted device comes back.

import { mergeSkills } from '../model.js';

export async function loadSkills(client, appliances) {
    const [listed, apps] = await Promise.all([client.listedSkills(), appliances || client.appliances()]);
    return mergeSkills(listed, apps);
}

const skills = {
    name: 'skills',
    group: 'Smart home',
    summary: 'Enabled skills and the devices each one provides',
    description: 'Amazon\'s "your skills" page leaves most smart-home skills out; they are found through their devices.',
    args: [{ name: 'text', help: 'Only skills whose name, id or devices contain this text' }],
    modes: ['json', 'plain'],
    async run(ctx, { args }) {
        const q = (args.text || '').toLowerCase();
        const list = (await loadSkills(await ctx.client()))
            .filter((s) => !q || [s.name || '', s.id, ...s.devices.map((d) => d.name)].some((x) => x.toLowerCase().includes(q)));
        ctx.out.list(list, [
            { title: 'NAME', value: (s) => s.name || '' },
            { title: 'TYPE', value: (s) => s.type || '' },
            { title: 'DEVICES', value: (s) => s.devices.map((d) => d.name), human: (s) => s.devices.map((d) => d.name).join(', ') || ctx.out.style.dim('—') },
            { title: 'ID', value: (s) => s.id, human: (s) => ctx.out.style.dim(s.id) },
        ], { empty: 'no skill' });
    },
};

export default [skills];

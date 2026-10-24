// The Devices tab: every appliance with its source and the routines that use it.

import { el } from '../dom.js';
import { actionsOf, label } from '../model.js';

const SOURCES = { AAA: 'Matter', SKILL: 'Skill' };

export function renderDevices(table, { view, store, actions, filter }) {
    if (!view.appliances) return table.replaceChildren(el('caption', { class: 'loading' }, 'Chargement des appareils…'));
    const used = new Map();
    for (const r of view.routines || []) {
        for (const a of actionsOf(r)) if (a.target) used.set(a.target, [...(used.get(a.target) || []), label(r)]);
    }
    const q = filter.trim().toLowerCase();
    const rows = view.appliances
        .filter((a) => !q || [a.friendlyName, a.manufacturerName || ''].some((s) => s.toLowerCase().includes(q)))
        .sort((a, b) => a.friendlyName.localeCompare(b.friendlyName, 'fr'));
    table.replaceChildren(
        el('thead', {}, el('tr', {}, ['Appareil', 'Fabricant', 'Source', 'Routines', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.map((a) => {
            const refs = [...new Set([a.applianceId, a.entityId].flatMap((id) => used.get(id) || []))];
            const source = String(a.applianceId).split('_')[0];
            return el('tr', { class: store.isPending(a.applianceId) ? 'pending' : '' },
                el('td', {}, a.friendlyName),
                el('td', {}, a.manufacturerName || ''),
                el('td', {}, el('span', { class: 'pill src' }, SOURCES[source] || source)),
                el('td', {}, refs.length ? refs.join(', ') : el('span', { class: 'hint' }, '—')),
                el('td', {}, el('button', { class: 'link danger-text', onclick: () => actions.forget(a) }, 'Supprimer')));
        })));
}

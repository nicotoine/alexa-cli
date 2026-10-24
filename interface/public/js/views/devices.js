// The Devices tab: every appliance with its source and the routines that use it. Column headers sort; the order
// and the filters come from listing.deviceRows.

import { el } from '../dom.js';
import { DEVICE_COLUMNS, deviceRows } from '../listing.js';

/** Draws the table; returns how many devices are shown (null while loading). */
export function renderDevices(table, { view, store, actions, criteria, onSort }) {
    if (!view.appliances) {
        table.replaceChildren(el('caption', { class: 'loading' }, 'Chargement des appareils…'));
        return null;
    }
    const rows = deviceRows(view, criteria);
    const header = Object.entries(DEVICE_COLUMNS).map(([column, title]) => {
        const active = criteria.sort === column;
        const sort = active ? (criteria.dir === 'desc' ? 'descending' : 'ascending') : 'none';
        return el('th', { 'aria-sort': sort },
            el('button', { class: `sort${active ? ' active' : ''}`, onclick: () => onSort(column),
                title: `Trier par ${title.toLowerCase()}` }, title, el('span', { class: 'arrow', 'aria-hidden': 'true' },
                active ? (criteria.dir === 'desc' ? '↓' : '↑') : '↕')));
    });
    table.replaceChildren(
        el('thead', {}, el('tr', {}, header, el('th', {}, el('span', { class: 'visually-hidden' }, 'Actions')))),
        el('tbody', {}, rows.length ? rows.map(({ a, source, refs }) => el('tr', { class: store.isPending(a.applianceId) ? 'pending' : '' },
            el('td', {}, a.friendlyName),
            el('td', {}, a.manufacturerName || ''),
            el('td', {}, el('span', { class: 'pill src' }, source)),
            el('td', {}, refs.length ? refs.join(', ') : el('span', { class: 'hint' }, '—')),
            el('td', {}, el('button', { class: 'link danger-text', onclick: () => actions.forget(a) }, 'Supprimer'))))
            : el('tr', {}, el('td', { colspan: '5', class: 'empty' }, 'Aucun appareil ne correspond aux filtres.'))));
    return rows.length;
}

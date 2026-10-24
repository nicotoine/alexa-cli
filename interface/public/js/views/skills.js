// The Skills tab: each skill and the devices it provides. A deleted device that shows up here again comes from a
// skill that is still linked.

import { el } from '../dom.js';
import { skillRows } from '../listing.js';

/** Draws the skills; returns how many are shown (null while loading). */
export function renderSkills(box, { view, criteria }) {
    if (!view.skills) {
        box.replaceChildren(el('div', { class: 'loading' }, 'Chargement des skills… (la page Amazon des skills est lente)'));
        return null;
    }
    const rows = skillRows(view, criteria);
    if (!rows.length) {
        box.replaceChildren(el('div', { class: 'empty' }, 'Aucune skill ne correspond aux filtres.'));
        return 0;
    }
    box.replaceChildren(...rows.map((s) => el('article', { class: 'card' },
        el('div', { class: 'card-head' },
            el('h3', {}, s.name || '(sans nom)'),
            el('span', { class: 'pill src' }, s.type || ''),
            el('span', { class: `pill ${s.devices.length ? 'on' : 'off'}` }, `${s.devices.length} appareil(s)`)),
        s.devices.length > 0 && el('div', { class: 'chips' }, s.devices.map((d) => el('span', { class: 'chip' }, d.name))),
        el('div', { class: 'targets' }, s.id))));
    return rows.length;
}

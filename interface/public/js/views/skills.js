// The Skills tab: each skill and the devices it provides. A deleted device that shows up here again comes from a
// skill that is still linked.

import { el } from '../dom.js';

export function renderSkills(box, { view }) {
    if (!view.skills) return box.replaceChildren(el('div', { class: 'loading' }, 'Chargement des skills… (la page Amazon des skills est lente)'));
    box.replaceChildren(...view.skills.map((s) => el('article', { class: 'card' },
        el('div', { class: 'card-head' },
            el('h3', {}, s.name || '(sans nom)'),
            el('span', { class: 'pill src' }, s.type || ''),
            el('span', { class: `pill ${s.devices.length ? 'on' : 'off'}` }, `${s.devices.length} appareil(s)`)),
        s.devices.length > 0 && el('div', { class: 'chips' }, s.devices.map((d) => el('span', { class: 'chip' }, d.name))),
        el('div', { class: 'targets' }, s.id))));
}

// The Audit tab: routines with an action on a device that no longer exists.

import { el } from '../dom.js';
import { OPS } from '../model.js';

export function renderAudit(box, { view }) {
    if (!view.audit) return box.replaceChildren(el('div', { class: 'loading' }, 'Vérification des routines…'));
    if (!view.audit.length) return box.replaceChildren(el('div', { class: 'empty' }, 'Aucune routine cassée.'));
    box.replaceChildren(...view.audit.map((r) => el('article', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, r.name), el('span', { class: 'pill warn' }, 'référence cassée')),
        el('div', { class: 'targets' }, r.missing.map((t, i) => [i ? ' · ' : '', `${OPS[t.op] || t.op} `,
            el('b', {}, t.name || `${t.target.slice(0, 12)}…`), ' (n\'existe plus)'])))));
}

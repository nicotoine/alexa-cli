// The Routines tab: one card per routine, phrases as chips, its actions, and what can be done to it.
// Which routines and in what order comes from listing.routineRows.

import { el } from '../dom.js';
import { routineRows } from '../listing.js';
import { OPS, deviceNames, isVoice, label, phraseOwner, targetName } from '../model.js';

function describe(action, names) {
    if (action.speak) return el('span', {}, 'dire « ', el('b', {}, action.speak), ' »');
    if (action.type) return el('span', {}, action.type.replace(/^Alexa\./, ''));
    const verb = action.op.split(',').map((o) => OPS[o] || o).join(', ');
    return el('span', {}, `${verb} `, el('b', {}, targetName(action.target, names) || `${action.target.slice(0, 12)}… (introuvable)`));
}

/** Draws the routines; returns how many are shown (null while loading). */
export function renderRoutines(box, { view, store, actions, criteria, toast, onRetarget, onRun }) {
    if (!view.routines) {
        box.replaceChildren(el('div', { class: 'loading' }, 'Chargement des routines…'));
        return null;
    }
    const names = deviceNames(view);
    const rows = routineRows(view, criteria);
    if (!rows.length) {
        const filtered = view.routines.length > 0;
        box.replaceChildren(el('div', { class: 'empty' }, filtered ? 'Aucune routine ne correspond aux filtres.' : 'Aucune routine.'));
        return 0;
    }

    box.replaceChildren(...rows.map(({ r, phrases, acts }) => {
        const id = r.automationId;
        const draft = Boolean(r.draft);
        const input = el('input', { type: 'text', placeholder: 'ajouter une phrase…', 'aria-label': `Ajouter une phrase à ${label(r)}` });
        const addPhrase = () => {
            const phrase = input.value.trim();
            if (!phrase) return;
            const owner = phraseOwner(view.routines, phrase, id);
            if (owner) return toast('Phrase déjà utilisée', { type: 'error', detail: `« ${phrase} » déclenche déjà « ${label(owner)} ».` });
            actions.editPhrases(r, { add: [phrase] });
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPhrase(); });

        return el('article', { class: `card${draft || store.isPending(id) ? ' pending' : ''}` },
            el('div', { class: 'card-head' },
                el('h3', {}, label(r)),
                el('span', { class: `pill ${r.status === 'ENABLED' ? 'on' : 'off'}` }, r.status === 'ENABLED' ? 'active' : 'désactivée'),
                !isVoice(r) && el('span', { class: 'pill src' }, (r.triggers || [])[0]?.type || 'autre déclencheur')),
            isVoice(r) && el('div', { class: 'chips' },
                phrases.map((p) => el('span', { class: 'chip' }, p,
                    phrases.length > 1 && !draft && el('button', { title: `Retirer « ${p} »`, 'aria-label': `Retirer ${p}`,
                        onclick: () => actions.editPhrases(r, { remove: [p] }) }, '×'))),
                !draft && el('span', { class: 'add-phrase' }, input, el('button', { class: 'small', onclick: addPhrase }, 'Ajouter'))),
            acts.length > 0 && el('div', { class: 'targets' }, acts.map((a, i) => [i ? ' · ' : '', describe(a, names)])),
            !draft && el('div', { class: 'card-actions' },
                el('button', { class: 'link', onclick: () => onRun(r) }, 'Lancer'),
                el('button', { class: 'link', onclick: () => actions.setStatus(r, r.status === 'ENABLED' ? 'DISABLED' : 'ENABLED') },
                    r.status === 'ENABLED' ? 'Désactiver' : 'Activer'),
                acts.some((a) => a.target) && el('button', { class: 'link', onclick: () => onRetarget(r, acts, names) }, 'Changer d\'appareil'),
                el('button', { class: 'link danger-text', onclick: () => actions.deleteRoutine(r) }, 'Supprimer')));
    }));
    return rows.length;
}

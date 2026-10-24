// The Routines tab: one card per routine, phrases as chips, its actions, and what can be done to it.

import { el } from '../dom.js';
import { OPS, actionsOf, deviceNames, isVoice, label, phraseOwner, phrasesOf, targetName } from '../model.js';

function describe(action, names) {
    if (action.speak) return el('span', {}, 'dire « ', el('b', {}, action.speak), ' »');
    if (action.type) return el('span', {}, action.type.replace(/^Alexa\./, ''));
    const verb = action.op.split(',').map((o) => OPS[o] || o).join(', ');
    return el('span', {}, `${verb} `, el('b', {}, targetName(action.target, names) || `${action.target.slice(0, 12)}… (introuvable)`));
}

export function renderRoutines(box, { view, store, actions, filter, toast, onRetarget, onRun }) {
    if (!view.routines) return box.replaceChildren(el('div', { class: 'loading' }, 'Chargement des routines…'));
    const names = deviceNames(view);
    const q = filter.trim().toLowerCase();
    const rows = view.routines
        .map((r) => ({ r, phrases: phrasesOf(r), acts: actionsOf(r) }))
        .filter(({ r, phrases, acts }) => !q || [label(r), ...phrases, ...acts.map((a) => (a.target && targetName(a.target, names)) || '')]
            .some((s) => s.toLowerCase().includes(q)))
        .sort((a, b) => label(a.r).localeCompare(label(b.r), 'fr'));
    if (!rows.length) return box.replaceChildren(el('div', { class: 'empty' }, q ? 'Aucune routine ne correspond.' : 'Aucune routine.'));

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
}

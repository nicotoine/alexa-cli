// Notifications: stacked bottom right, each with an optional action (Annuler, Réessayer, Forcer).

import { $, el } from './dom.js';

export function toast(message, { type = 'info', detail, action, duration } = {}) {
    const close = () => box.remove();
    // Built with el(), which drops a missing action: the native append() wrote it as the text "undefined".
    const box = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
        el('div', { class: 'msg' }, message, detail && el('small', {}, detail)),
        action && el('button', { class: type === 'error' ? 'danger' : 'primary', onclick: () => { close(); action.run(); } }, action.label),
        el('button', { class: 'close', 'aria-label': 'Fermer', onclick: close }, '×'));
    $('#toasts').append(box);
    const ms = duration ?? (type === 'error' ? 12000 : 4000);
    if (ms) setTimeout(close, ms);
    return close;
}

const KNOWN = [
    [/phrase already used by: (.*)/, (m) => `Phrase déjà utilisée par « ${m[1]} ».`],
    [/still used by \d+ routine\(s\): (.*?) \(--force/, (m) => `Encore utilisé par : ${m[1]}.`],
    [/not logged in/, () => 'Non connecté à Amazon : lancez « alexa-cli login ».'],
    [/401|Unauthorized|Cookie invalid/, () => 'Session Amazon expirée : relancez « alexa-cli login ».'],
    [/no routine matches/, () => 'Cette routine n\'existe plus chez Amazon.'],
    [/no device is named "(.*)"/, (m) => `Aucun appareil ne s'appelle « ${m[1]} ».`],
    [/a routine needs at least one phrase/, () => 'Une routine garde au moins une phrase.'],
    [/Input failed to validate/, () => 'Amazon a refusé la modification (données invalides).'],
    [/Failed to fetch|NetworkError/, () => 'Serveur de l\'interface injoignable.'],
];

/** The CLI's English error, in French when it is a known one. Pure: tested in Node. */
export function explain(message) {
    const m = String(message || '').trim().replace(/^error: /, '');
    for (const [pattern, say] of KNOWN) {
        const match = m.match(pattern);
        if (match) return say(match);
    }
    return m || 'Erreur inconnue.';
}

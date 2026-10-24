// The sort and filter choices of each tab. Kept in this browser only (a per-viewer convenience): storage may be
// unavailable or throw — private window, blocked site data — and the page then simply starts from the defaults.

import { DEVICE_DEFAULTS, ROUTINE_DEFAULTS, SKILL_DEFAULTS } from './listing.js';

const KEY = 'alexa-cli.prefs.v1';
export const DEFAULTS = { routines: ROUTINE_DEFAULTS, devices: DEVICE_DEFAULTS, skills: SKILL_DEFAULTS };

export function loadPrefs(storage = globalThis.localStorage) {
    let saved = {};
    try {
        saved = JSON.parse(storage.getItem(KEY) || '{}') || {};
    } catch {
        saved = {};
    }
    // Only known keys, so a stale or hand-edited entry cannot inject anything the listing does not expect.
    return Object.fromEntries(Object.entries(DEFAULTS).map(([tab, defaults]) => [tab, Object.fromEntries(
        Object.entries(defaults).map(([k, v]) => [k, saved[tab] && typeof saved[tab][k] === typeof v ? saved[tab][k] : v]),
    )]));
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
    try {
        storage.setItem(KEY, JSON.stringify(prefs));
    } catch {
        // Not saved: the choices still apply for this visit.
    }
}

/** Reads a control's value with the type its default has. */
export function controlValue(control, defaults, key) {
    if (typeof defaults[key] === 'boolean') return control.checked;
    return control.value;
}

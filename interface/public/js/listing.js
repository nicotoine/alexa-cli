// Sorting and filtering of each tab, as pure functions of the view and the chosen criteria: tested in Node, and
// the views only draw what comes out.

import { actionsOf, deviceNames, isVoice, label, phrasesOf, targetName } from './model.js';

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const byText = (get) => (a, b) => collator.compare(get(a) || '', get(b) || '');
const byNumber = (get) => (a, b) => get(a) - get(b);
const reverse = (cmp) => (a, b) => -cmp(a, b);
// Ties fall back to the name, so the order never depends on what Amazon happened to return first.
const then = (...cmps) => (a, b) => cmps.reduce((r, c) => r || c(a, b), 0);
const contains = (q) => (s) => String(s || '').toLowerCase().includes(q);

// ---- routines ---------------------------------------------------------------------------------------------

export const ROUTINE_SORTS = {
    'name-asc': 'Nom (A → Z)',
    'name-desc': 'Nom (Z → A)',
    'status': 'Actives d\'abord',
    'phrases': 'Le plus de phrases',
    'device': 'Appareil piloté',
};

export const ROUTINE_DEFAULTS = { sort: 'name-asc', status: 'all', trigger: 'all', device: '', broken: false, text: '' };

/** Routine rows ({ r, phrases, acts, devices }) filtered and sorted. */
export function routineRows(view, criteria = {}) {
    const c = { ...ROUTINE_DEFAULTS, ...criteria };
    const names = deviceNames(view);
    const brokenIds = new Set((view.audit || []).map((b) => b.automationId));
    const q = c.text.trim().toLowerCase();
    const rows = (view.routines || []).map((r) => {
        const acts = actionsOf(r);
        const devices = acts.filter((a) => a.target).map((a) => targetName(a.target, names)).filter(Boolean);
        return { r, phrases: phrasesOf(r), acts, devices };
    }).filter(({ r, phrases, devices }) => (c.status === 'all' || r.status === c.status)
        && (c.trigger === 'all' || (c.trigger === 'voice') === isVoice(r))
        && (!c.device || devices.includes(c.device))
        && (!c.broken || brokenIds.has(r.automationId))
        && (!q || [label(r), ...phrases, ...devices].some(contains(q))));

    const name = byText((x) => label(x.r));
    const sorts = {
        'name-asc': name,
        'name-desc': reverse(name),
        status: then(byNumber((x) => (x.r.status === 'ENABLED' ? 0 : 1)), name),
        phrases: then(reverse(byNumber((x) => x.phrases.length)), name),
        device: then(byText((x) => x.devices[0] || '￿'), name),
    };
    return rows.sort(sorts[c.sort] || name);
}

/** The devices routines act on, for the "appareil" filter. */
export function routineDevices(view) {
    const names = deviceNames(view);
    const set = new Set();
    for (const r of view.routines || []) for (const a of actionsOf(r)) if (a.target && targetName(a.target, names)) set.add(targetName(a.target, names));
    return [...set].sort(collator.compare);
}

// ---- devices ----------------------------------------------------------------------------------------------

export const DEVICE_COLUMNS = {
    name: 'Appareil',
    maker: 'Fabricant',
    source: 'Source',
    routines: 'Routines',
};

export const DEVICE_DEFAULTS = { sort: 'name', dir: 'asc', source: 'all', maker: '', used: 'all', text: '' };

const SOURCES = { AAA: 'Matter', SKILL: 'Skill' };
export const sourceOf = (a) => {
    const prefix = String(a.applianceId).split('_')[0];
    return SOURCES[prefix] || prefix;
};

/** Device rows ({ a, source, refs }) filtered and sorted; refs are the names of the routines using the device. */
export function deviceRows(view, criteria = {}) {
    const c = { ...DEVICE_DEFAULTS, ...criteria };
    const used = new Map();
    for (const r of view.routines || []) {
        for (const a of actionsOf(r)) if (a.target) used.set(a.target, [...(used.get(a.target) || []), label(r)]);
    }
    const q = c.text.trim().toLowerCase();
    const rows = (view.appliances || []).map((a) => ({
        a,
        source: sourceOf(a),
        refs: [...new Set([a.applianceId, a.entityId].flatMap((id) => used.get(id) || []))],
    })).filter(({ a, source, refs }) => (c.source === 'all' || source === c.source)
        && (!c.maker || (a.manufacturerName || '') === c.maker)
        && (c.used === 'all' || (c.used === 'yes') === refs.length > 0)
        && (!q || [a.friendlyName, a.manufacturerName].some(contains(q))));

    const name = byText((x) => x.a.friendlyName);
    const columns = {
        name,
        maker: byText((x) => x.a.manufacturerName),
        source: byText((x) => x.source),
        routines: byNumber((x) => x.refs.length),
    };
    // The direction applies to the chosen column only; ties stay in name order either way.
    const column = columns[c.sort] || name;
    return rows.sort(then(c.dir === 'desc' ? reverse(column) : column, name));
}

export function deviceFacets(view) {
    const apps = view.appliances || [];
    return {
        sources: [...new Set(apps.map(sourceOf))].sort(collator.compare),
        makers: [...new Set(apps.map((a) => a.manufacturerName).filter(Boolean))].sort(collator.compare),
    };
}

/** Clicking a column: the same column flips the direction, another one starts ascending. */
export function nextDeviceSort(criteria, column) {
    const c = { ...DEVICE_DEFAULTS, ...criteria };
    return c.sort === column ? { ...c, dir: c.dir === 'asc' ? 'desc' : 'asc' } : { ...c, sort: column, dir: 'asc' };
}

// ---- skills -----------------------------------------------------------------------------------------------

export const SKILL_SORTS = { devices: 'Le plus d\'appareils', 'name-asc': 'Nom (A → Z)' };
export const SKILL_DEFAULTS = { sort: 'devices', type: 'all', withDevices: false };

export function skillRows(view, criteria = {}) {
    const c = { ...SKILL_DEFAULTS, ...criteria };
    const name = byText((s) => s.name);
    const rows = (view.skills || []).filter((s) => (c.type === 'all' || s.type === c.type) && (!c.withDevices || s.devices.length > 0));
    return rows.sort(c.sort === 'name-asc' ? name : then(reverse(byNumber((s) => s.devices.length)), name));
}

export const skillTypes = (view) => [...new Set((view.skills || []).map((s) => s.type).filter(Boolean))].sort(collator.compare);

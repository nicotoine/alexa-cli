// Boot: the store, the streamed snapshot, the sync indicator, and the wiring of the controls.

import { createActions } from './actions.js';
import { change, snapshot } from './api.js';
import { $, el } from './dom.js';
import { ROUTINE_SORTS, SKILL_SORTS, deviceFacets, nextDeviceSort, routineDevices, skillTypes } from './listing.js';
import { label, phraseOwner } from './model.js';
import { DEFAULTS, controlValue, loadPrefs, savePrefs } from './prefs.js';
import { createStore } from './store.js';
import { explain, toast } from './toasts.js';
import { renderAudit } from './views/audit.js';
import { renderDevices } from './views/devices.js';
import { renderRoutines } from './views/routines.js';
import { renderSkills } from './views/skills.js';

const KINDS = ['routines', 'devices', 'appliances', 'skills', 'audit'];
let lastSync = '';
let prefs = loadPrefs();

const store = createStore({ kinds: KINDS, onChange: render });
const actions = createActions({ store, change, toast, explain, resync: scheduleResync });

// ---- rendering ----------------------------------------------------------------------------------------------

function render(changed = KINDS) {
    const k = new Set(changed);
    // The audit feeds the "cassées" filter and names the devices, so it redraws the routines too.
    const lists = changed.length === 0 || ['routines', 'devices', 'appliances', 'audit'].some((x) => k.has(x));
    const ctx = { view: store.view, store, actions, toast };
    if (lists) {
        fillFacets();
        count('#routine-count', renderRoutines($('#routines'), { ...ctx, criteria: prefs.routines, onRetarget: retargetDialog, onRun: confirmRun }), store.view.routines, 'routine');
        count('#device-count', renderDevices($('#devices'), { ...ctx, criteria: prefs.devices, onSort: sortDevices }), store.view.appliances, 'appareil');
        fillDeviceSelect($('#create-device'));
    }
    if (k.has('skills') || changed.length === 0) {
        fillFacets();
        count('#skill-count', renderSkills($('#skills'), { ...ctx, criteria: prefs.skills }), store.view.skills, 'skill');
    }
    if (k.has('audit')) renderAudit($('#audit'), ctx);
    showSync();
}

function count(selector, shown, all, noun) {
    const total = (all || []).length;
    $(selector).textContent = shown === null ? '' : shown === total ? `${total} ${noun}${total > 1 ? 's' : ''}` : `${shown} sur ${total}`;
}

// ---- sort and filter controls ---------------------------------------------------------------------------------

function options(select, entries, value) {
    select.replaceChildren(...entries.map(([v, text]) => el('option', { value: v, selected: v === value }, text)));
}

// Options that depend on the data (devices, makers, types) are rebuilt when it changes; the choice is kept.
function fillFacets() {
    const view = store.view;
    options($('#routine-sort'), Object.entries(ROUTINE_SORTS), prefs.routines.sort);
    options($('#routine-device'), [['', 'Tous'], ...routineDevices(view).map((d) => [d, d])], prefs.routines.device);
    const { sources, makers } = deviceFacets(view);
    options($('#device-source'), [['all', 'Toutes'], ...sources.map((s) => [s, s])], prefs.devices.source);
    options($('#device-maker'), [['', 'Tous'], ...makers.map((m) => [m, m])], prefs.devices.maker);
    options($('#skill-sort'), Object.entries(SKILL_SORTS), prefs.skills.sort);
    options($('#skill-type'), [['all', 'Tous'], ...skillTypes(view).map((t) => [t, t])], prefs.skills.type);
}

// Sets every [data-pref] control from the saved choices (texts and checkboxes; selects are set by fillFacets).
function showPrefs() {
    for (const control of document.querySelectorAll('[data-pref]')) {
        const [tab, key] = control.dataset.pref.split('.');
        if (control.type === 'checkbox') control.checked = Boolean(prefs[tab][key]);
        else if (control.tagName === 'INPUT') control.value = prefs[tab][key];
        else if ([...control.options].some((o) => o.value === prefs[tab][key])) control.value = prefs[tab][key];
    }
}

function setPrefs(tab, next) {
    prefs = { ...prefs, [tab]: next };
    savePrefs(prefs);
    render(tab === 'skills' ? ['skills'] : ['routines']);
}

function sortDevices(column) {
    setPrefs('devices', nextDeviceSort(prefs.devices, column));
}

function showSync(state, text) {
    const s = $('#sync');
    if (text) lastSync = text;
    const saving = store.saving();
    s.dataset.state = saving ? 'saving' : (state || s.dataset.state || 'ok');
    s.textContent = saving ? `Enregistrement (${saving})…` : lastSync;
}

function fillDeviceSelect(select, selected = select.value) {
    const devices = [...(store.view.devices || [])].sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
    select.replaceChildren(...devices.map((d) => el('option', { value: d.displayName, selected: d.displayName === selected }, d.displayName)));
    return select;
}

// ---- loading: streamed, cached copy first ---------------------------------------------------------------------

let loading = null;
async function load({ silent = false } = {}) {
    if (loading) return loading;
    const since = Date.now();
    if (!silent) showSync('loading', 'Chargement…');
    loading = (async () => {
        let fresh = 0;
        try {
            for await (const msg of snapshot()) {
                if (msg.kind === 'error') {
                    toast(`Chargement incomplet (${msg.data.kind})`, { type: 'error', detail: explain(msg.data.message) });
                    continue;
                }
                store.receive(msg.kind, msg.data, { cached: Boolean(msg.cached), since });
                if (msg.cached) showSync('cached', 'Cache affiché, mise à jour…');
                else fresh++;
            }
            if (fresh) showSync('ok', `À jour · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
            else showSync('error', 'Hors ligne');
        } catch (e) {
            showSync('error', 'Hors ligne');
            if (!silent) toast('Impossible de charger les données', { type: 'error', detail: explain(e.message), action: { label: 'Réessayer', run: () => load() } });
        } finally {
            loading = null;
        }
    })();
    return loading;
}

// Once every change in flight is answered, reload quietly so the page matches Amazon again.
let resyncTimer;
function scheduleResync() {
    clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => (store.saving() ? scheduleResync() : load({ silent: true })), 1200);
}

// ---- dialogs --------------------------------------------------------------------------------------------------

function ask(title, text, okLabel) {
    const dialog = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel;
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

async function confirmRun(r) {
    if (await ask(`Lancer « ${label(r)} »`, 'La routine va s\'exécuter maintenant, comme si on l\'avait dite à l\'Echo.', 'Lancer')) actions.run(r);
}

function retargetDialog(r, acts, names) {
    const devices = acts.filter((a) => a.target);
    const nameOf = (a) => names.get(a.target) || a.target;
    const from = el('select', {}, devices.map((a) => el('option', { value: nameOf(a) }, nameOf(a))));
    const to = fillDeviceSelect(el('select', {}), '');
    const dialog = el('dialog', {}, el('form', { method: 'dialog' },
        el('h2', {}, `Changer d'appareil — ${label(r)}`),
        devices.length > 1 && el('label', {}, 'Appareil à remplacer', from),
        el('label', {}, 'Nouvel appareil', to),
        el('div', { class: 'actions' },
            el('button', { value: 'cancel', class: 'ghost' }, 'Annuler'),
            el('button', { value: 'ok', class: 'primary' }, 'Changer'))));
    document.body.append(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => {
        const go = dialog.returnValue === 'ok';
        const choice = { from: devices.length > 1 ? from.value : null, to: to.value };
        dialog.remove();
        if (go) actions.retarget(r, choice.from, choice.to);
    }, { once: true });
}

// ---- wiring ---------------------------------------------------------------------------------------------------

document.querySelectorAll('.tabs button').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${btn.dataset.tab}`; });
}));

for (const control of document.querySelectorAll('[data-pref]')) {
    const [tab, key] = control.dataset.pref.split('.');
    control.addEventListener(control.type === 'search' ? 'input' : 'change', () => {
        setPrefs(tab, { ...prefs[tab], [key]: controlValue(control, DEFAULTS[tab], key) });
    });
}
for (const button of document.querySelectorAll('[data-reset]')) {
    button.addEventListener('click', () => {
        const tab = button.dataset.reset;
        // The text filter is kept: resetting is about the sort and the menus.
        setPrefs(tab, { ...DEFAULTS[tab], ...(prefs[tab].text !== undefined ? { text: prefs[tab].text } : {}) });
        showPrefs();
    });
}
$('#refresh').addEventListener('click', () => load());

$('#new-routine').addEventListener('click', () => { $('#create-form').hidden = false; $('#create-phrases').focus(); });
$('#create-cancel').addEventListener('click', () => { $('#create-form').hidden = true; });
$('#create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const phrases = $('#create-phrases').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!phrases.length) return toast('Ajoutez au moins une phrase.', { type: 'error' });
    const taken = phrases.find((p) => phraseOwner(store.view.routines, p));
    if (taken) return toast('Phrase déjà utilisée', { type: 'error', detail: `« ${taken} » déclenche déjà « ${label(phraseOwner(store.view.routines, taken))} ».` });
    actions.create(phrases, $('#create-device').value, $('#create-op').value);
    $('#create-form').hidden = true;
    $('#create-phrases').value = '';
});

// Leaving while a change waits (undo window or in flight) would lose it.
window.addEventListener('beforeunload', (e) => {
    if (store.saving()) e.preventDefault();
});

showPrefs();
render();
load();

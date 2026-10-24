// Boot: the store, the streamed snapshot, the sync indicator, and the wiring of the controls.

import { createActions } from './actions.js';
import { change, snapshot } from './api.js';
import { $, el } from './dom.js';
import { label, phraseOwner } from './model.js';
import { createStore } from './store.js';
import { explain, toast } from './toasts.js';
import { renderAudit } from './views/audit.js';
import { renderDevices } from './views/devices.js';
import { renderRoutines } from './views/routines.js';
import { renderSkills } from './views/skills.js';

const KINDS = ['routines', 'devices', 'appliances', 'skills', 'audit'];
let lastSync = '';

const store = createStore({ kinds: KINDS, onChange: render });
const actions = createActions({ store, change, toast, explain, resync: scheduleResync });

// ---- rendering ----------------------------------------------------------------------------------------------

function render(changed = KINDS) {
    const k = new Set(changed);
    const all = changed.length === 0 || k.has('routines') || k.has('devices') || k.has('appliances');
    const ctx = { view: store.view, store, actions, toast };
    if (all) {
        renderRoutines($('#routines'), { ...ctx, filter: $('#routine-filter').value, onRetarget: retargetDialog, onRun: confirmRun });
        renderDevices($('#devices'), { ...ctx, filter: $('#device-filter').value });
        fillDeviceSelect($('#create-device'));
    }
    if (k.has('skills')) renderSkills($('#skills'), ctx);
    if (k.has('audit')) renderAudit($('#audit'), ctx);
    showSync();
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

$('#routine-filter').addEventListener('input', () => render(['routines']));
$('#device-filter').addEventListener('input', () => render(['appliances']));
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

render();
load();

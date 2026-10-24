'use strict';

// Everything goes through the local server, which runs alexa-cli. Text from Amazon is only ever set with
// textContent, never as HTML.

const state = { routines: null, devices: null, appliances: null, skills: null, audit: null };
const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

let toastTimer;
function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, isError ? 9000 : 4500);
}

async function list(kind) {
  const res = await fetch(`/api/list/${kind}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function cli(command, body) {
  const res = await fetch(`/api/do/${command}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Alexa-Cli': '1' },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (res.status === 400 || res.status === 403 || res.status === 404) throw new Error(out.error || res.statusText);
  return out;
}

const cliMessage = (out) => (out.stdout || '').trim() || (out.stderr || '').trim().replace(/^error: /, '');

// ---- confirmation: show the CLI's dry run, then apply ----------------------------------------------------

function ask(title, plan, { force = false, okLabel = 'Appliquer', danger = true } = {}) {
  const dialog = $('#confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-plan').textContent = plan;
  $('#confirm-force-row').hidden = !force;
  $('#confirm-force').checked = false;
  const ok = $('#confirm-ok');
  ok.textContent = okLabel;
  ok.className = danger ? 'danger' : 'primary';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'
      ? { forced: $('#confirm-force').checked } : null), { once: true });
  });
}

async function change(command, body, title, { refresh = ['routines'] } = {}) {
  busy(true);
  try {
    const dry = await cli(command, { ...body, apply: false });
    const blockedByRoutines = !dry.ok && /still used by/.test(dry.stderr || '');
    if (!dry.ok && !blockedByRoutines) return toast(cliMessage(dry), true);
    busy(false);
    const answer = await ask(title, cliMessage(dry), { force: blockedByRoutines });
    if (!answer) return;
    if (blockedByRoutines && !answer.forced) return toast('Annulé : appareil encore utilisé par une routine.', true);
    busy(true);
    const done = await cli(command, { ...body, apply: true, ...(answer.forced ? { force: true } : {}) });
    toast(cliMessage(done), !done.ok);
    if (done.ok) await reload(refresh);
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy(false);
  }
}

function busy(on) {
  document.body.style.cursor = on ? 'progress' : '';
  document.querySelectorAll('button').forEach((b) => { b.disabled = on; });
}

// ---- data helpers ----------------------------------------------------------------------------------------

function phrasesOf(r) {
  return (r.triggers || []).flatMap((t) => (t.payload && (t.payload.utterances || [t.payload.utterance])) || []).filter(Boolean);
}

function label(r) {
  return r.name || phrasesOf(r).join(' / ') || '(sans nom)';
}

function targetsOf(r) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (String(n['@type'] || '').endsWith('OperationNode') && n.operationPayload) {
      let p = n.operationPayload;
      if (typeof p === 'string') try { p = JSON.parse(p); } catch { p = {}; }
      if (p.target) out.push({ target: p.target, op: (p.operations || []).map((o) => o.type).join(',') });
      else if (p.textToSpeak) out.push({ speak: p.textToSpeak });
      else out.push({ type: n.type });
    }
    Object.values(n).forEach(walk);
  };
  walk(r.sequence);
  return out;
}

function deviceNames() {
  const names = new Map();
  for (const d of state.devices || []) names.set(d.id, d.displayName);
  for (const a of state.appliances || []) {
    for (const id of [a.applianceId, a.entityId, a.id]) if (id) names.set(id, a.friendlyName);
  }
  return names;
}

const OPS = { turnOn: 'allumer', turnOff: 'éteindre' };

function describeTarget(t, names) {
  if (t.speak) return el('span', {}, 'dire « ', el('b', {}, t.speak), ' »');
  if (t.type) return el('span', {}, t.type.replace(/^Alexa\./, ''));
  const all = { 'virtual@LIGHT': 'toutes les lumières', 'virtual@SMARTPLUG': 'toutes les prises' };
  const name = names.get(t.target) || all[t.target.split('@').slice(0, 2).join('@')] || `${t.target.slice(0, 12)}… (introuvable)`;
  return el('span', {}, `${t.op.split(',').map((o) => OPS[o] || o).join(', ')} `, el('b', {}, name));
}

// ---- routines --------------------------------------------------------------------------------------------

function renderRoutines() {
  const box = $('#routines');
  box.replaceChildren();
  if (!state.routines) return box.append(el('div', { class: 'loading' }, 'Chargement des routines…'));
  const names = deviceNames();
  const q = $('#routine-filter').value.trim().toLowerCase();
  const rows = state.routines
    .map((r) => ({ r, phrases: phrasesOf(r), targets: targetsOf(r) }))
    .filter(({ r, phrases, targets }) => !q || [label(r), ...phrases,
      ...targets.map((t) => names.get(t.target) || '')].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => label(a.r).localeCompare(label(b.r), 'fr'));
  if (!rows.length) return box.append(el('div', { class: 'empty' }, 'Aucune routine.'));

  for (const { r, phrases, targets } of rows) {
    const id = r.automationId;
    const isVoice = (r.triggers || []).some((t) => t.type === 'CustomUtterance');
    const input = el('input', { type: 'text', placeholder: 'ajouter une phrase…', 'aria-label': `Ajouter une phrase à ${label(r)}` });
    const addPhrase = () => {
      const v = input.value.trim();
      if (v) change('phrases', { target: id, add: [v] }, `Ajouter « ${v} »`);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPhrase(); });

    box.append(el('article', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h3', {}, label(r)),
        el('span', { class: `pill ${r.status === 'ENABLED' ? 'on' : 'off'}` }, r.status === 'ENABLED' ? 'active' : 'désactivée'),
        !isVoice && el('span', { class: 'pill src' }, (r.triggers || [])[0]?.type || 'autre déclencheur')),
      isVoice && el('div', { class: 'chips' },
        phrases.map((p) => el('span', { class: 'chip' }, p,
          phrases.length > 1 && el('button', { title: `Retirer « ${p} »`, 'aria-label': `Retirer ${p}`,
            onclick: () => change('phrases', { target: id, remove: [p] }, `Retirer « ${p} »`) }, '×'))),
        el('span', { class: 'add-phrase' }, input, el('button', { class: 'small', onclick: addPhrase }, 'Ajouter'))),
      targets.length > 0 && el('div', { class: 'targets' },
        targets.map((t, i) => [i ? ' · ' : '', describeTarget(t, names)])),
      el('div', { class: 'card-actions' },
        el('button', { class: 'link', onclick: () => runRoutine(r) }, 'Lancer'),
        r.status === 'ENABLED'
          ? el('button', { class: 'link', onclick: () => change('disable', { target: id }, `Désactiver « ${label(r)} »`) }, 'Désactiver')
          : el('button', { class: 'link', onclick: () => change('enable', { target: id }, `Activer « ${label(r)} »`) }, 'Activer'),
        targets.some((t) => t.target) && el('button', { class: 'link', onclick: () => retarget(r, targets, names) }, 'Changer d\'appareil'),
        el('button', { class: 'link danger-text', onclick: () => change('delete', { target: id }, `Supprimer « ${label(r)} »`) }, 'Supprimer'))));
  }
}

async function runRoutine(r) {
  const ok = await ask(`Lancer « ${label(r)} »`, 'La routine va s\'exécuter maintenant, comme si on l\'avait dite à l\'Echo.',
    { okLabel: 'Lancer', danger: false });
  if (!ok) return;
  busy(true);
  try {
    const out = await cli('run', { target: r.automationId });
    toast(cliMessage(out), !out.ok);
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy(false);
  }
}

function deviceSelect(selected) {
  const sel = el('select', {});
  for (const d of [...(state.devices || [])].sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'))) {
    sel.append(el('option', { value: d.displayName, selected: d.displayName === selected }, d.displayName));
  }
  return sel;
}

async function retarget(r, targets, names) {
  const devTargets = targets.filter((t) => t.target);
  const dialog = el('dialog', {});
  const fromSel = el('select', {}, devTargets.map((t) => el('option', { value: names.get(t.target) || t.target }, names.get(t.target) || t.target)));
  const toSel = deviceSelect();
  dialog.append(el('form', { method: 'dialog' },
    el('h2', {}, `Changer d'appareil — ${label(r)}`),
    devTargets.length > 1 && el('label', {}, 'Appareil à remplacer', fromSel),
    el('label', {}, 'Nouvel appareil', toSel),
    el('div', { class: 'actions' }, el('button', { value: 'cancel', class: 'ghost' }, 'Annuler'),
      el('button', { value: 'ok', class: 'primary' }, 'Vérifier'))));
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => {
    const go = dialog.returnValue === 'ok';
    const body = { target: r.automationId, device: toSel.value, ...(devTargets.length > 1 ? { from: fromSel.value } : {}) };
    dialog.remove();
    if (go) change('retarget', body, `Changer d'appareil — ${label(r)}`);
  }, { once: true });
}

// ---- devices, skills, audit ------------------------------------------------------------------------------

function renderDevices() {
  const table = $('#devices');
  table.replaceChildren();
  if (!state.appliances) return table.append(el('caption', { class: 'loading' }, 'Chargement des appareils…'));
  const q = $('#device-filter').value.trim().toLowerCase();
  const used = new Map();
  for (const r of state.routines || []) {
    for (const t of targetsOf(r)) if (t.target) used.set(t.target, [...(used.get(t.target) || []), label(r)]);
  }
  const rows = state.appliances
    .filter((a) => !q || [a.friendlyName, a.manufacturerName || ''].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => a.friendlyName.localeCompare(b.friendlyName, 'fr'));
  table.append(el('thead', {}, el('tr', {}, ['Appareil', 'Fabricant', 'Source', 'Routines', ''].map((h) => el('th', {}, h)))));
  table.append(el('tbody', {}, rows.map((a) => {
    const refs = [a.applianceId, a.entityId].flatMap((id) => used.get(id) || []);
    const source = String(a.applianceId).split('_')[0];
    return el('tr', {},
      el('td', {}, a.friendlyName),
      el('td', {}, a.manufacturerName || ''),
      el('td', {}, el('span', { class: 'pill src' }, source === 'AAA' ? 'Matter' : source === 'SKILL' ? 'Skill' : source)),
      el('td', {}, refs.length ? refs.join(', ') : el('span', { class: 'hint' }, '—')),
      el('td', {}, el('button', { class: 'link danger-text',
        onclick: () => change('forget', { target: a.applianceId }, `Supprimer l'appareil « ${a.friendlyName} »`,
          { refresh: ['appliances', 'devices', 'skills'] }) }, 'Supprimer')));
  })));
}

function renderSkills() {
  const box = $('#skills');
  box.replaceChildren();
  if (!state.skills) return box.append(el('div', { class: 'loading' }, 'Chargement des skills…'));
  for (const s of state.skills) {
    box.append(el('article', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h3', {}, s.name || '(sans nom)'),
        el('span', { class: 'pill src' }, s.type || ''),
        el('span', { class: `pill ${s.devices.length ? 'on' : 'off'}` }, `${s.devices.length} appareil(s)`)),
      s.devices.length > 0 && el('div', { class: 'chips' }, s.devices.map((d) => el('span', { class: 'chip' }, d.name))),
      el('div', { class: 'targets' }, s.id)));
  }
}

function renderAudit() {
  const box = $('#audit');
  box.replaceChildren();
  if (!state.audit) return box.append(el('div', { class: 'loading' }, 'Vérification des routines…'));
  if (!state.audit.length) return box.append(el('div', { class: 'empty' }, 'Aucune routine cassée.'));
  for (const r of state.audit) {
    box.append(el('article', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, r.name), el('span', { class: 'pill warn' }, 'référence cassée')),
      el('div', { class: 'targets' }, r.missing.map((t, i) => [i ? ' · ' : '', `${OPS[t.op] || t.op} `,
        el('b', {}, t.name || `${t.target.slice(0, 12)}…`), ' (n\'existe plus)']))));
  }
}

const renderers = { routines: [renderRoutines, renderDevices], devices: [renderRoutines, renderDevices],
  appliances: [renderRoutines, renderDevices], skills: [renderSkills], audit: [renderAudit] };

async function reload(kinds = Object.keys(state)) {
  const tasks = kinds.map(async (k) => {
    try {
      state[k] = await list(k);
    } catch (e) {
      toast(`${k} : ${e.message}`, true);
      state[k] = state[k] || [];
    }
    renderers[k].forEach((fn) => fn());
    if (k === 'devices') fillCreateDevices();
  });
  await Promise.all(tasks);
}

function fillCreateDevices() {
  const sel = $('#create-device');
  const current = sel.value;
  sel.replaceChildren(...deviceSelect(current).children);
}

// ---- wiring ----------------------------------------------------------------------------------------------

document.querySelectorAll('.tabs button').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${btn.dataset.tab}`; });
}));

$('#routine-filter').addEventListener('input', renderRoutines);
$('#device-filter').addEventListener('input', renderDevices);
$('#refresh').addEventListener('click', () => {
  Object.keys(state).forEach((k) => { state[k] = null; });
  Object.values(renderers).flat().forEach((fn) => fn());
  reload();
});

$('#new-routine').addEventListener('click', () => { $('#create-form').hidden = false; $('#create-phrases').focus(); });
$('#create-cancel').addEventListener('click', () => { $('#create-form').hidden = true; });
$('#create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const phrases = $('#create-phrases').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!phrases.length) return toast('Au moins une phrase.', true);
  change('create', { phrase: phrases, device: $('#create-device').value, op: $('#create-op').value },
    `Créer « ${phrases[0]} »`).then(() => { $('#create-form').hidden = true; $('#create-phrases').value = ''; });
});

Object.values(renderers).flat().forEach((fn) => fn());
// Routines and devices first (the main tab), the slower lists after.
reload(['routines', 'devices', 'appliances']).then(() => reload(['skills', 'audit']));

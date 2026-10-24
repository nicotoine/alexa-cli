'use strict';

// Everything goes through the local server, which runs alexa-cli. Text from Amazon is only ever set with
// textContent, never as HTML.
//
// Optimistic interface: what is shown is the last data from Amazon (`base`) with every change still in
// progress applied on top (`ops`). A change is drawn at once, sent in the background, and simply dropped from
// `ops` if it is undone or fails, so the view falls back to what Amazon says without disturbing other changes.

const KINDS = ['routines', 'devices', 'appliances', 'skills', 'audit'];
const base = Object.fromEntries(KINDS.map((k) => [k, null]));
const view = Object.fromEntries(KINDS.map((k) => [k, null]));
const ops = new Set();
let opSeq = 0;

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

// ---- toasts ----------------------------------------------------------------------------------------------

function toast(message, { type = 'info', detail, action, duration } = {}) {
  const box = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' });
  const close = () => box.remove();
  box.append(
    el('div', { class: 'msg' }, message, detail && el('small', {}, detail)),
    action && el('button', { class: type === 'error' ? 'danger' : 'primary', onclick: () => { close(); action.run(); } }, action.label),
    el('button', { class: 'close', 'aria-label': 'Fermer', onclick: close }, '×'));
  $('#toasts').append(box);
  const ms = duration ?? (type === 'error' ? 12000 : 4000);
  if (ms) setTimeout(close, ms);
  return close;
}

// The CLI's English errors, said in French when they are known.
function explain(message) {
  const m = String(message || '').trim().replace(/^error: /, '');
  let r;
  if ((r = m.match(/phrase already used by: (.*)/))) return `Phrase déjà utilisée par « ${r[1]} ».`;
  if ((r = m.match(/still used by \d+ routine\(s\): (.*?) \(--force/))) return `Encore utilisé par : ${r[1]}.`;
  if (/not logged in/.test(m)) return 'Non connecté à Amazon : lancez « alexa-cli login ».';
  if (/no routine matches/.test(m)) return 'Cette routine n\'existe plus chez Amazon.';
  if (/a routine needs at least one phrase/.test(m)) return 'Une routine garde au moins une phrase.';
  if (/Input failed to validate/.test(m)) return 'Amazon a refusé la modification (données invalides).';
  if (/401|Unauthorized|Cookie invalid/.test(m)) return 'Session Amazon expirée : relancez « alexa-cli login ».';
  if (/Failed to fetch|NetworkError/.test(m)) return 'Serveur de l\'interface injoignable.';
  return m || 'Erreur inconnue.';
}

// ---- server calls ----------------------------------------------------------------------------------------

async function cli(command, body) {
  const res = await fetch(`/api/do/${command}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Alexa-Cli': '1' },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({ ok: false, stderr: res.statusText }));
  if (!res.ok && !('stderr' in out)) out.stderr = out.error || res.statusText;
  return out;
}

// Streams the snapshot: each part is drawn as soon as its line arrives (routines first).
let streaming = null;
async function stream({ silent = false } = {}) {
  if (streaming) return streaming;
  const startedAt = Date.now();
  if (!silent) setSync('loading', 'Chargement…');
  streaming = (async () => {
    let pending = '';
    let fresh = 0;
    try {
      const res = await fetch('/api/snapshot');
      if (!res.ok || !res.body) throw new Error(res.statusText);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        let nl;
        while ((nl = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.kind === 'error') {
            toast(`Chargement incomplet (${msg.data.kind})`, { type: 'error', detail: explain(msg.data.message) });
            continue;
          }
          if (msg.cached && base[msg.kind]) continue;
          base[msg.kind] = msg.data;
          if (!msg.cached) {
            fresh++;
            // Changes Amazon confirmed before this snapshot started are now in its data.
            for (const op of ops) if (op.doneAt && op.doneAt < startedAt && op.kinds.includes(msg.kind)) op.settled.add(msg.kind);
            prune();
          }
          recompute([msg.kind]);
          if (msg.cached) setSync('cached', 'Cache affiché, mise à jour…');
        }
      }
      if (fresh) setSync('ok', `À jour · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
      else setSync('error', 'Hors ligne');
    } catch (e) {
      setSync('error', 'Hors ligne');
      if (!silent) toast('Impossible de charger les données', { type: 'error', detail: explain(e.message), action: { label: 'Réessayer', run: () => stream() } });
    } finally {
      streaming = null;
    }
  })();
  return streaming;
}

function setSync(state, text) {
  const s = $('#sync');
  const saving = [...ops].filter((o) => !o.doneAt).length;
  s.dataset.state = saving ? 'saving' : state;
  s.textContent = saving ? `Enregistrement (${saving})…` : text;
  s.dataset.idle = text;
}

// ---- optimistic operations -------------------------------------------------------------------------------

function clone(v) {
  return v == null ? v : structuredClone(v);
}

function recompute(kinds = KINDS) {
  for (const k of kinds) {
    view[k] = clone(base[k]);
  }
  // Patches are idempotent and skip lists not loaded yet, so they can run whatever has arrived so far.
  for (const op of ops) {
    if (!op.kinds.some((k) => kinds.includes(k))) continue;
    try {
      op.patch(view);
    } catch (e) {
      console.error('patch', e);
    }
  }
  render(kinds);
}

// Done changes stay drawn until a snapshot started after them has refreshed every list they touch.
function prune() {
  for (const op of ops) if (op.doneAt && op.kinds.every((k) => op.settled.has(k))) ops.delete(op);
}

let resyncTimer;
function scheduleResync() {
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => {
    if ([...ops].some((o) => !o.doneAt)) return scheduleResync();
    stream({ silent: true });
  }, 1200);
}

function isPending(key) {
  return [...ops].some((o) => !o.doneAt && o.key === key);
}

/**
 * Draw a change at once and send it. With `undo`, the change waits `undo` ms behind an "Annuler" toast before
 * anything is sent. On failure the change is dropped (the view returns to Amazon's state) and a toast says why.
 */
function optimistic({ key, kinds, patch, command, body, label, done, undo = 0, onError }) {
  const op = { id: ++opSeq, key, kinds, patch, settled: new Set(), doneAt: null };
  ops.add(op);
  recompute(kinds);
  setSync('saving');

  const fail = (message) => {
    ops.delete(op);
    recompute(kinds);
    refreshSync();
    const handled = onError && onError(message);
    if (!handled) {
      toast(`Échec : ${label}`, { type: 'error', detail: explain(message),
        action: { label: 'Réessayer', run: () => optimistic({ key, kinds, patch, command, body, label, done, undo: 0, onError }) } });
    }
  };

  const send = async () => {
    try {
      const out = await cli(command, { ...body, apply: true });
      if (!out.ok) return fail(out.stderr || out.stdout);
      op.doneAt = Date.now();
      refreshSync();
      if (done) toast(done, { type: 'success' });
      scheduleResync();
    } catch (e) {
      fail(e.message);
    }
  };

  if (!undo) return send();
  let cancelled = false;
  const timer = setTimeout(() => { if (!cancelled) { dismiss(); send(); } }, undo);
  const dismiss = toast(label, {
    duration: undo,
    action: { label: 'Annuler', run: () => {
      cancelled = true;
      clearTimeout(timer);
      ops.delete(op);
      recompute(kinds);
      refreshSync();
    } },
  });
}

function refreshSync() {
  const s = $('#sync');
  const saving = [...ops].filter((o) => !o.doneAt).length;
  if (saving) {
    s.dataset.state = 'saving';
    s.textContent = `Enregistrement (${saving})…`;
  } else if (s.dataset.state === 'saving') {
    s.dataset.state = 'ok';
    s.textContent = s.dataset.idle && !/Enregistrement/.test(s.dataset.idle) ? s.dataset.idle : 'Enregistré';
  }
}

// ---- data helpers ----------------------------------------------------------------------------------------

function phrasesOf(r) {
  return (r.triggers || []).flatMap((t) => (t.payload && (t.payload.utterances || [t.payload.utterance])) || []).filter(Boolean);
}

function label(r) {
  return r.name || phrasesOf(r).join(' / ') || '(sans nom)';
}

function opPayloads(r, fn) {
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (String(n['@type'] || '').endsWith('OperationNode') && n.operationPayload) {
      if (typeof n.operationPayload === 'string') {
        try { n.operationPayload = JSON.parse(n.operationPayload); } catch { n.operationPayload = {}; }
      }
      fn(n.operationPayload, n);
    }
    Object.values(n).forEach(walk);
  };
  walk(r.sequence);
}

function targetsOf(r) {
  const out = [];
  opPayloads(r, (p, n) => {
    if (p.target) out.push({ target: p.target, op: (p.operations || []).map((o) => o.type).join(',') });
    else if (p.textToSpeak) out.push({ speak: p.textToSpeak });
    else out.push({ type: n.type });
  });
  return out;
}

function deviceNames() {
  const names = new Map();
  for (const d of view.devices || []) names.set(d.id, d.displayName);
  for (const a of view.appliances || []) {
    for (const id of [a.applianceId, a.entityId, a.id]) if (id) names.set(id, a.friendlyName);
  }
  return names;
}

function idsOfName(name) {
  const k = name.toLowerCase();
  return new Set([...(view.devices || []).filter((d) => d.displayName.toLowerCase() === k).map((d) => d.id),
    ...(view.appliances || []).filter((a) => a.friendlyName.toLowerCase() === k).flatMap((a) => [a.applianceId, a.entityId, a.id])]
    .filter(Boolean));
}

const findRoutine = (v, id) => (v.routines || []).find((r) => r.automationId === id);
const OPS = { turnOn: 'allumer', turnOff: 'éteindre' };

function describeTarget(t, names) {
  if (t.speak) return el('span', {}, 'dire « ', el('b', {}, t.speak), ' »');
  if (t.type) return el('span', {}, t.type.replace(/^Alexa\./, ''));
  const all = { 'virtual@LIGHT': 'toutes les lumières', 'virtual@SMARTPLUG': 'toutes les prises' };
  const name = names.get(t.target) || all[t.target.split('@').slice(0, 2).join('@')] || `${t.target.slice(0, 12)}… (introuvable)`;
  return el('span', {}, `${t.op.split(',').map((o) => OPS[o] || o).join(', ')} `, el('b', {}, name));
}

// ---- actions ---------------------------------------------------------------------------------------------

function setStatus(r, status) {
  const id = r.automationId;
  const on = status === 'ENABLED';
  optimistic({
    key: id, kinds: ['routines'],
    patch: (v) => { const x = findRoutine(v, id); if (x) x.status = status; },
    command: on ? 'enable' : 'disable', body: { target: id },
    label: `${on ? 'Activer' : 'Désactiver'} « ${label(r)} »`,
    done: `« ${label(r)} » ${on ? 'activée' : 'désactivée'}`,
  });
}

function editPhrases(r, { add = [], remove = [] }) {
  const id = r.automationId;
  const what = add.length ? `Ajouter « ${add[0]} »` : `Retirer « ${remove[0]} »`;
  optimistic({
    key: id, kinds: ['routines'],
    patch: (v) => {
      const x = findRoutine(v, id);
      const t = x && (x.triggers || []).find((tr) => tr.type === 'CustomUtterance');
      if (!t) return;
      const drop = remove.map((p) => p.toLowerCase());
      const current = phrasesOf({ triggers: [t] });
      const next = [...current.filter((p) => !drop.includes(p.toLowerCase())),
        ...add.filter((p) => !current.some((c) => c.toLowerCase() === p.toLowerCase()))];
      t.payload.utterances = next;
      t.payload.utterance = next[0];
    },
    command: 'phrases', body: { target: id, add, remove },
    label: `${what} — ${label(r)}`,
    done: `${what} : enregistré`,
  });
}

function deleteRoutine(r) {
  const id = r.automationId;
  optimistic({
    key: id, kinds: ['routines', 'audit'],
    patch: (v) => {
      if (v.routines) v.routines = v.routines.filter((x) => x.automationId !== id);
      if (v.audit) v.audit = v.audit.filter((x) => x.automationId !== id);
    },
    command: 'delete', body: { target: id },
    label: `Routine « ${label(r)} » supprimée`,
    done: `« ${label(r)} » supprimée chez Amazon`,
    undo: 5000,
  });
}

function retargetRoutine(r, fromName, toName) {
  const id = r.automationId;
  const toId = [...idsOfName(toName)][0];
  const fromIds = fromName ? idsOfName(fromName) : null;
  optimistic({
    key: id, kinds: ['routines'],
    patch: (v) => {
      const x = findRoutine(v, id);
      if (!x || !toId) return;
      opPayloads(x, (p) => { if (p.target && (!fromIds || fromIds.has(p.target))) p.target = toId; });
    },
    command: 'retarget', body: { target: id, device: toName, ...(fromName ? { from: fromName } : {}) },
    label: `« ${label(r)} » → ${toName}`,
    done: `« ${label(r)} » vise maintenant ${toName}`,
  });
}

function createRoutine(phrases, device, op) {
  const tempId = `pending-${++opSeq}`;
  const toId = [...idsOfName(device)][0];
  optimistic({
    key: tempId, kinds: ['routines'],
    patch: (v) => {
      if (!v.routines || v.routines.some((x) => x.automationId === tempId)) return;
      v.routines.push({
        automationId: tempId, name: phrases[0], status: 'ENABLED', pending: true,
        triggers: [{ type: 'CustomUtterance', payload: { utterance: phrases[0], utterances: phrases } }],
        sequence: { startNode: { '@type': 'OpaquePayloadOperationNode', operationPayload: { target: toId, operations: [{ type: op }] } } },
      });
    },
    command: 'create', body: { phrase: phrases, device, op },
    label: `Créer « ${phrases[0]} »`,
    done: `Routine « ${phrases[0]} » créée`,
  });
}

function forgetDevice(a, force = false) {
  const ids = new Set([a.applianceId, a.entityId, a.id].filter(Boolean));
  optimistic({
    key: a.applianceId, kinds: ['appliances', 'devices', 'skills'],
    patch: (v) => {
      if (v.appliances) v.appliances = v.appliances.filter((x) => x.applianceId !== a.applianceId);
      if (v.devices) v.devices = v.devices.filter((d) => !ids.has(d.id));
      for (const s of v.skills || []) s.devices = s.devices.filter((d) => d.applianceId !== a.applianceId);
    },
    command: 'forget', body: { target: a.applianceId, ...(force ? { force: true } : {}) },
    label: `Appareil « ${a.friendlyName} » supprimé`,
    done: `« ${a.friendlyName} » supprimé d'Alexa`,
    undo: force ? 0 : 5000,
    onError: (message) => {
      if (!/still used by/.test(message)) return false;
      toast(`« ${a.friendlyName} » n'a pas été supprimé`, { type: 'error', detail: `${explain(message)} Le supprimer cassera ces routines.`,
        action: { label: 'Forcer', run: () => forgetDevice(a, true) } });
      return true;
    },
  });
}

async function runRoutine(r) {
  if (!await ask(`Lancer « ${label(r)} »`, 'La routine va s\'exécuter maintenant, comme si on l\'avait dite à l\'Echo.', 'Lancer')) return;
  const dismiss = toast(`Lancement de « ${label(r)} »…`, { duration: 0 });
  try {
    const out = await cli('run', { target: r.automationId });
    dismiss();
    if (out.ok) toast(`« ${label(r)} » lancée`, { type: 'success' });
    else toast(`Échec du lancement de « ${label(r)} »`, { type: 'error', detail: explain(out.stderr || out.stdout) });
  } catch (e) {
    dismiss();
    toast('Échec du lancement', { type: 'error', detail: explain(e.message) });
  }
}

function ask(title, text, okLabel = 'Confirmer') {
  const dialog = $('#confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

// ---- rendering -------------------------------------------------------------------------------------------

function loading(box, text) {
  box.replaceChildren(el('div', { class: 'loading' }, text));
}

function renderRoutines() {
  const box = $('#routines');
  if (!view.routines) return loading(box, 'Chargement des routines…');
  box.replaceChildren();
  const names = deviceNames();
  const q = $('#routine-filter').value.trim().toLowerCase();
  const rows = view.routines
    .map((r) => ({ r, phrases: phrasesOf(r), targets: targetsOf(r) }))
    .filter(({ r, phrases, targets }) => !q || [label(r), ...phrases,
      ...targets.map((t) => names.get(t.target) || '')].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => label(a.r).localeCompare(label(b.r), 'fr'));
  if (!rows.length) return box.append(el('div', { class: 'empty' }, 'Aucune routine.'));

  for (const { r, phrases, targets } of rows) {
    const id = r.automationId;
    const pending = r.pending || isPending(id);
    const isVoice = (r.triggers || []).some((t) => t.type === 'CustomUtterance');
    const input = el('input', { type: 'text', placeholder: 'ajouter une phrase…', 'aria-label': `Ajouter une phrase à ${label(r)}` });
    const addPhrase = () => {
      const v = input.value.trim();
      if (!v) return;
      const owner = view.routines.find((x) => x.automationId !== id && phrasesOf(x).some((p) => p.toLowerCase() === v.toLowerCase()));
      if (owner) return toast('Phrase déjà utilisée', { type: 'error', detail: `« ${v} » déclenche déjà « ${label(owner)} ».` });
      editPhrases(r, { add: [v] });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPhrase(); });

    box.append(el('article', { class: `card${pending ? ' pending' : ''}` },
      el('div', { class: 'card-head' },
        el('h3', {}, label(r)),
        el('span', { class: `pill ${r.status === 'ENABLED' ? 'on' : 'off'}` }, r.status === 'ENABLED' ? 'active' : 'désactivée'),
        !isVoice && el('span', { class: 'pill src' }, (r.triggers || [])[0]?.type || 'autre déclencheur')),
      isVoice && el('div', { class: 'chips' },
        phrases.map((p) => el('span', { class: 'chip' }, p,
          phrases.length > 1 && !r.pending && el('button', { title: `Retirer « ${p} »`, 'aria-label': `Retirer ${p}`,
            onclick: () => editPhrases(r, { remove: [p] }) }, '×'))),
        !r.pending && el('span', { class: 'add-phrase' }, input, el('button', { class: 'small', onclick: addPhrase }, 'Ajouter'))),
      targets.length > 0 && el('div', { class: 'targets' }, targets.map((t, i) => [i ? ' · ' : '', describeTarget(t, names)])),
      !r.pending && el('div', { class: 'card-actions' },
        el('button', { class: 'link', onclick: () => runRoutine(r) }, 'Lancer'),
        el('button', { class: 'link', onclick: () => setStatus(r, r.status === 'ENABLED' ? 'DISABLED' : 'ENABLED') },
          r.status === 'ENABLED' ? 'Désactiver' : 'Activer'),
        targets.some((t) => t.target) && el('button', { class: 'link', onclick: () => retargetDialog(r, targets, names) }, 'Changer d\'appareil'),
        el('button', { class: 'link danger-text', onclick: () => deleteRoutine(r) }, 'Supprimer'))));
  }
}

function deviceSelect(selected) {
  const sel = el('select', {});
  for (const d of [...(view.devices || [])].sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'))) {
    sel.append(el('option', { value: d.displayName, selected: d.displayName === selected }, d.displayName));
  }
  return sel;
}

function retargetDialog(r, targets, names) {
  const devTargets = targets.filter((t) => t.target);
  const dialog = el('dialog', {});
  const fromSel = el('select', {}, devTargets.map((t) => el('option', { value: names.get(t.target) || t.target }, names.get(t.target) || t.target)));
  const toSel = deviceSelect();
  dialog.append(el('form', { method: 'dialog' },
    el('h2', {}, `Changer d'appareil — ${label(r)}`),
    devTargets.length > 1 && el('label', {}, 'Appareil à remplacer', fromSel),
    el('label', {}, 'Nouvel appareil', toSel),
    el('div', { class: 'actions' }, el('button', { value: 'cancel', class: 'ghost' }, 'Annuler'),
      el('button', { value: 'ok', class: 'primary' }, 'Changer'))));
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => {
    const go = dialog.returnValue === 'ok';
    const from = devTargets.length > 1 ? fromSel.value : null;
    const to = toSel.value;
    dialog.remove();
    if (go) retargetRoutine(r, from, to);
  }, { once: true });
}

function renderDevices() {
  const table = $('#devices');
  if (!view.appliances) {
    table.replaceChildren(el('caption', { class: 'loading' }, 'Chargement des appareils…'));
    return;
  }
  table.replaceChildren();
  const q = $('#device-filter').value.trim().toLowerCase();
  const used = new Map();
  for (const r of view.routines || []) {
    for (const t of targetsOf(r)) if (t.target) used.set(t.target, [...(used.get(t.target) || []), label(r)]);
  }
  const rows = view.appliances
    .filter((a) => !q || [a.friendlyName, a.manufacturerName || ''].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => a.friendlyName.localeCompare(b.friendlyName, 'fr'));
  table.append(el('thead', {}, el('tr', {}, ['Appareil', 'Fabricant', 'Source', 'Routines', ''].map((h) => el('th', {}, h)))));
  table.append(el('tbody', {}, rows.map((a) => {
    const refs = [...new Set([a.applianceId, a.entityId].flatMap((id) => used.get(id) || []))];
    const source = String(a.applianceId).split('_')[0];
    return el('tr', { class: isPending(a.applianceId) ? 'pending' : '' },
      el('td', {}, a.friendlyName),
      el('td', {}, a.manufacturerName || ''),
      el('td', {}, el('span', { class: 'pill src' }, source === 'AAA' ? 'Matter' : source === 'SKILL' ? 'Skill' : source)),
      el('td', {}, refs.length ? refs.join(', ') : el('span', { class: 'hint' }, '—')),
      el('td', {}, el('button', { class: 'link danger-text', onclick: () => forgetDevice(a) }, 'Supprimer')));
  })));
}

function renderSkills() {
  const box = $('#skills');
  if (!view.skills) return loading(box, 'Chargement des skills… (la page Amazon des skills est lente)');
  box.replaceChildren();
  for (const s of [...view.skills].sort((a, b) => b.devices.length - a.devices.length || String(a.name).localeCompare(String(b.name), 'fr'))) {
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
  if (!view.audit) return loading(box, 'Vérification des routines…');
  box.replaceChildren();
  if (!view.audit.length) return box.append(el('div', { class: 'empty' }, 'Aucune routine cassée.'));
  for (const r of view.audit) {
    box.append(el('article', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, r.name), el('span', { class: 'pill warn' }, 'référence cassée')),
      el('div', { class: 'targets' }, r.missing.map((t, i) => [i ? ' · ' : '', `${OPS[t.op] || t.op} `,
        el('b', {}, t.name || `${t.target.slice(0, 12)}…`), ' (n\'existe plus)']))));
  }
}

function render(kinds) {
  const k = new Set(kinds);
  if (k.has('routines') || k.has('devices') || k.has('appliances')) {
    renderRoutines();
    renderDevices();
    fillCreateDevices();
  }
  if (k.has('skills')) renderSkills();
  if (k.has('audit')) renderAudit();
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
$('#refresh').addEventListener('click', () => stream());

$('#new-routine').addEventListener('click', () => { $('#create-form').hidden = false; $('#create-phrases').focus(); });
$('#create-cancel').addEventListener('click', () => { $('#create-form').hidden = true; });
$('#create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const phrases = $('#create-phrases').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!phrases.length) return toast('Ajoutez au moins une phrase.', { type: 'error' });
  const taken = phrases.map((p) => ({ p, owner: (view.routines || []).find((r) => phrasesOf(r).some((x) => x.toLowerCase() === p.toLowerCase())) }))
    .find((x) => x.owner);
  if (taken) return toast('Phrase déjà utilisée', { type: 'error', detail: `« ${taken.p} » déclenche déjà « ${label(taken.owner)} ».` });
  createRoutine(phrases, $('#create-device').value, $('#create-op').value);
  $('#create-form').hidden = true;
  $('#create-phrases').value = '';
});

// Leaving while a change is still waiting (undo window or in flight) would lose it.
window.addEventListener('beforeunload', (e) => {
  if ([...ops].some((o) => !o.doneAt)) e.preventDefault();
});

render(KINDS);
stream();

import { marked } from './vendor/marked.esm.js';
import { motif } from './motifs.js';

marked.setOptions({ breaks: true });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const APP_ID = 'projet-interculturel-edd';
const STORE_KEY = 'pi-edd-v1';
const LP_BASE = 'https://tg.lehrplan.ch/';
const LP_SEARCH = (q) => `${LP_BASE}index.php?code=s&suchwort=${encodeURIComponent(q)}`;
const REDACTION = new URLSearchParams(location.search).has('redaction');
const ANSWER_TYPES = ['reponse', 'tableau', 'tri', 'autocontrole', 'silhouette', 'mindmap'];

const md = (s) => marked.parse(s || '');
const mdInline = (s) => marked.parseInline(s || '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, html = '') => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  if (html) n.innerHTML = html;
  return n;
};
const countWords = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;
const tacheLabel = (t) => (t.numero === 'finale' ? 'Tâche finale' : `Tâche ${t.numero}`);

// ---------------------------------------------------------------------------
// État (les réponses restent sur l’appareil)
// ---------------------------------------------------------------------------
let state = loadLocal();
let parcours = null;
const taches = {};
let fileHandle = null;
let autosaveTimer = null;

function freshState() {
  return { app: APP_ID, version: 1, answers: {}, inclurePrive: false, savedAt: null, changedAt: null, etapes: {} };
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
  } catch (e) { /* stockage indisponible */ }
  return freshState();
}
function persistLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
const getA = (id, fallback) => (state.answers[id] !== undefined ? state.answers[id] : fallback);
function setA(id, value) {
  state.answers[id] = value;
  state.changedAt = new Date().toISOString();
  persistLocal();
  updateSaveStatus();
  renderSidebarProgress();
  document.dispatchEvent(new CustomEvent('answer-change', { detail: id }));
  if (fileHandle) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveToHandle().catch(() => updateSaveStatus()), 1500);
  }
}

// ---------------------------------------------------------------------------
// Contenu
// ---------------------------------------------------------------------------
async function loadContent() {
  const bust = `?v=${Date.now()}`;
  parcours = await fetch(`/content/parcours.json${bust}`).then((r) => r.json());
  await Promise.all(parcours.taches.map(async (id) => {
    taches[id] = await fetch(`/content/taches/${id}.json${bust}`).then((r) => r.json());
  }));
}
const allBlocks = () => parcours.taches.flatMap((id) => taches[id].blocs.map((b) => ({ ...b, tache: id })));
const privateIds = () => new Set(allBlocks().filter((b) => b.prive).map((b) => b.id));

// Une étape commence à chaque consigne ; ce qui précède forme l’introduction.
function stepsOf(id) {
  const t = taches[id];
  const steps = [{ titre: 'Introduction', intro: true, blocs: [] }];
  for (const b of t.blocs) {
    if (b.type === 'consigne') steps.push({ titre: b.titre, consigne: b, blocs: [b] });
    else steps[steps.length - 1].blocs.push(b);
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Enregistrer / reprendre
// ---------------------------------------------------------------------------
function exportPayload() {
  const priv = privateIds();
  const answers = {};
  for (const [k, v] of Object.entries(state.answers)) {
    if (!priv.has(k) || state.inclurePrive) answers[k] = v;
  }
  return JSON.stringify({ app: APP_ID, version: 1, savedAt: new Date().toISOString(), inclurePrive: state.inclurePrive, answers }, null, 2);
}
async function saveToHandle() {
  const w = await fileHandle.createWritable();
  await w.write(exportPayload());
  await w.close();
  markSaved();
}
function markSaved() {
  state.savedAt = new Date().toISOString();
  persistLocal();
  updateSaveStatus();
}
async function save() {
  try {
    if ('showSaveFilePicker' in window) {
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: 'mon-parcours-interculturel.json',
          types: [{ description: 'Fichier de parcours', accept: { 'application/json': ['.json'] } }],
        });
        rememberHandle(fileHandle);
      }
      await saveToHandle();
      const bar = $('#reconnect'); if (bar) bar.hidden = true;
    } else {
      const blob = new Blob([exportPayload()], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'mon-parcours-interculturel.json' });
      document.body.append(a); a.click(); a.remove();
      markSaved();
    }
  } catch (e) {
    if (e.name !== 'AbortError') alert('L’enregistrement n’a pas abouti : ' + e.message);
  }
}
function applyFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { alert('Ce fichier n’est pas un fichier de parcours.'); return false; }
  if (data.app !== APP_ID || typeof data.answers !== 'object') { alert('Ce fichier ne correspond pas à ce parcours.'); return false; }
  const priv = privateIds();
  const kept = {};
  for (const id of priv) if (state.answers[id] !== undefined && data.answers[id] === undefined) kept[id] = state.answers[id];
  state.answers = { ...data.answers, ...kept };
  state.inclurePrive = !!data.inclurePrive;
  state.changedAt = data.savedAt || new Date().toISOString();
  markSaved();
  renderSidebarProgress();
  route();
  return true;
}
async function openFile() {
  if ('showOpenFilePicker' in window) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'Fichier de parcours', accept: { 'application/json': ['.json'] } }] });
      const text = await (await h.getFile()).text();
      if (applyFile(text)) { fileHandle = h; rememberHandle(h); updateSaveStatus(); }
    } catch (e) { if (e.name !== 'AbortError') alert('Ouverture impossible : ' + e.message); }
  } else {
    $('#file-input').click();
  }
}
$('#file-input').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if (f) applyFile(await f.text());
  ev.target.value = '';
});


// ---------------------------------------------------------------------------
// Mémoriser le fichier entre deux visites (Chrome/Edge, File System Access API)
// ---------------------------------------------------------------------------
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pi-edd', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', mode);
      const r = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(r && r.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const rememberHandle = (h) => idb('readwrite', (st) => st.put(h, 'fichier')).catch(() => {});
const recallHandle = () => idb('readonly', (st) => st.get('fichier')).catch(() => null);

async function reconnectFile() {
  if (!('showSaveFilePicker' in window)) return;
  const h = await recallHandle();
  if (!h || !h.queryPermission) return;
  const p = await h.queryPermission({ mode: 'readwrite' });
  if (p === 'granted') { fileHandle = h; updateSaveStatus(); return; }
  const bar = $('#reconnect');
  bar.innerHTML = '';
  bar.append(el('span', {}, `Continuer à enregistrer dans <strong>${esc(h.name)}</strong> ?`));
  bar.append(el('button', { class: 'btn save small', onclick: async () => {
    try {
      if (await h.requestPermission({ mode: 'readwrite' }) === 'granted') { fileHandle = h; bar.hidden = true; await saveToHandle(); }
    } catch (e) { bar.hidden = true; }
  } }, 'Oui, continuer'));
  bar.append(el('button', { class: 'link', onclick: () => { bar.hidden = true; } }, 'Plus tard'));
  bar.hidden = false;
}

function relTime(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
const isDirty = () => state.changedAt && (!state.savedAt || state.changedAt > state.savedAt);
function updateSaveStatus() {
  const txt = !state.savedAt && !state.changedAt ? ''
    : isDirty() ? (fileHandle ? 'Enregistrement…' : 'Pas encore enregistré dans un fichier')
    : `Enregistré ${relTime(state.savedAt)}`;
  const cls = 'save-status ' + (!txt ? '' : isDirty() && !fileHandle ? 'warn' : 'ok');
  document.querySelectorAll('[data-save-status]').forEach((s) => { s.textContent = txt; s.className = cls; });
  document.body.classList.toggle('needs-save', !!(isDirty() && !fileHandle));
}
setInterval(updateSaveStatus, 60000);
window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------------------
// Plan d’études (panneau latéral)
// ---------------------------------------------------------------------------
function openLP(url) {
  $('#drawer').hidden = false;
  document.body.classList.add('drawer-open');
  $('#lp-frame').src = url || LP_BASE;
  $('#lp-newtab').href = url || LP_BASE;
}
$('#btn-lp').addEventListener('click', () => openLP());
$('#drawer-close').addEventListener('click', () => { $('#drawer').hidden = true; document.body.classList.remove('drawer-open'); });
$('#lp-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#lp-q').value.trim();
  if (q) openLP(LP_SEARCH(q));
});

// ---------------------------------------------------------------------------
// Navigation latérale
// ---------------------------------------------------------------------------
function tacheProgress(id) {
  const blocks = taches[id].blocs.filter((b) => b.type === 'reponse' || b.type === 'tableau');
  if (!blocks.length) return 0;
  const done = blocks.filter((b) => {
    const v = state.answers[b.id];
    if (b.type === 'tableau') return Array.isArray(v) && v.some((row) => row.some((c) => c && c.trim()));
    return typeof v === 'string' && v.trim();
  }).length;
  return Math.round((done / blocks.length) * 100);
}
function renderSidebar(activeT, activeStep) {
  const nav = $('#sidebar');
  nav.innerHTML = '';
  nav.append(el('a', { href: '#/', class: !activeT ? 'active' : '' }, '<span class="lbl">Accueil</span>'));
  for (const id of parcours.taches) {
    const t = taches[id];
    const a = el('a', { href: `#/${id}/${state.etapes[id] || 0}`, class: 'tache-link' + (activeT === id ? ' active' : '') },
      `<span class="mini">${motif(id)}</span><span class="lbl">${esc(tacheLabel(t))}<strong>${esc(t.titre_court || t.titre)}</strong></span><span class="prog" data-prog="${id}"></span>`);
    nav.append(a);
    if (activeT === id) {
      const ol = el('ol', { class: 'steps-nav' });
      stepsOf(id).forEach((s, i) => {
        ol.append(el('li', {}, `<a href="#/${id}/${i}" class="${i === activeStep ? 'current' : ''}">${mdInline(s.titre.replace(/^Activité \d+ — |^\d+[a-z]?\. /, ''))}</a>`));
      });
      nav.append(ol);
    }
  }
  nav.append(el('a', { href: '#/dossier', class: activeT === 'dossier' ? 'active' : '' }, '<span class="lbl">Mon dossier</span>'));
  nav.append(el('a', { href: '#/aide', class: 'aide-link' + (activeT === 'aide' ? ' active' : '') }, '<span class="lbl">Mode d’emploi</span>'));
  const lp = el('a', { href: '#', class: 'aide-link' }, '<span class="lbl">Plan d’études</span>');
  lp.addEventListener('click', (e) => { e.preventDefault(); openLP(); });
  nav.append(lp);
  renderSidebarProgress();
}
function renderSidebarProgress() {
  document.querySelectorAll('[data-prog]').forEach((n) => {
    const p = tacheProgress(n.dataset.prog);
    n.innerHTML = `<span style="width:${p}%"></span>`;
    n.title = `${p} % des réponses`;
  });
}
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
function renderHome(main) {
  const p = parcours;
  main.append(el('section', { class: 'home-hero' }, `
    ${motif('accueil', 'hero-motif')}
    <div>
      <p class="eyebrow">${esc(p.sous_titre)} · ${esc(p.semestre)}</p>
      <h1>${esc(p.titre)}</h1>
      <div class="lead">${md(p.intro)}</div>
    </div>`));
  const grid = el('div', { class: 'tache-grid' });
  for (const id of p.taches) {
    const t = taches[id];
    const prog = tacheProgress(id);
    const card = el('a', { class: 'tache-card', href: `#/${id}/${state.etapes[id] || 0}` }, `
      ${motif(id)}
      <span class="eyebrow">${esc(tacheLabel(t))}</span>
      <h2>${esc(t.titre_court || t.titre)}</h2>
      <p class="chips"><span>${esc(t.duree)}</span><span>${esc(t.modalite)}</span></p>
      <span class="prog"><span style="width:${prog}%"></span></span>
      <span class="go">${prog ? 'Continuer' : 'Commencer'} →</span>`);
    grid.append(card);
  }
  main.append(grid);
  const more = el('div', { class: 'home-more' });
  more.append(el('details', { class: 'soft' }, `<summary>Cadre de travail</summary><div class="prose">${md(p.cadre)}</div>`));
  more.append(el('details', { class: 'soft' }, `<summary>Objectifs du parcours</summary><ul class="prose">${p.objectifs.map((o) => `<li>${mdInline(o)}</li>`).join('')}</ul>`));
  more.append(el('details', { class: 'soft private-note' }, `<summary>Vos réponses restent chez vous</summary><div class="prose">${md(p.sauvegarde)}</div>`));
  main.append(more);
  const sw = el('div', { class: 'theme-switch' }, '<span>Variante de couleurs (test) :</span>');
  const cur = document.documentElement.dataset.theme || 'bleu';
  for (const [k, label] of [['bleu', 'A · Bleu'], ['phtg', 'B · PHTG']]) {
    sw.append(el('button', { type: 'button', 'aria-pressed': String(cur === k), onclick: () => {
      if (k === 'bleu') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = k;
      try { localStorage.setItem('pi-edd-theme', k); } catch (e) { /* ignore */ }
      route();
    } }, label));
  }
  main.append(sw);
}



function showInfo(force = false) {
  let hide = false;
  try { hide = localStorage.getItem('pi-edd-info-masquee') === '1'; } catch (e) { /* ignore */ }
  if (hide && !force) return;
  const back = el('div', { class: 'modal-back' });
  const dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'info-t' }, `
    ${motif('accueil', 'modal-motif')}
    <h2 id="info-t">${esc(parcours.info_titre || 'Avant de commencer')}</h2>
    <div class="prose">${md(parcours.info || '')}</div>`);
  const lab = el('label', { class: 'toggle small' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = hide;
  lab.append(cb, document.createTextNode(' Ne plus afficher ce message au démarrage'));
  const ok = el('button', { class: 'btn primary' }, 'J’ai compris');
  ok.addEventListener('click', () => {
    try { localStorage.setItem('pi-edd-info-masquee', cb.checked ? '1' : '0'); } catch (e) { /* ignore */ }
    back.remove();
    document.body.classList.remove('modal-open');
  });
  const foot = el('div', { class: 'modal-foot' });
  foot.append(lab, ok);
  dlg.append(foot);
  back.append(dlg);
  document.body.append(back);
  document.body.classList.add('modal-open');
  ok.focus({ preventScroll: true });
  dlg.scrollTop = 0;
}

function renderAide(main) {
  main.append(el('section', { class: 'tache-hero' }, `${motif('accueil', 'hero-motif')}<div><h1>Mode d’emploi</h1>
    <p class="lead">Comment travailler avec l’application — en six points.</p></div>`));
  const list = el('ol', { class: 'aide-list' });
  (parcours.mode_emploi || []).forEach((p) => list.append(el('li', {}, `<h3>${esc(p.titre)}</h3><div class="prose">${md(p.texte)}</div>`)));
  main.append(list);
  const row = el('div', { class: 'row' });
  row.append(el('button', { class: 'btn save', onclick: save }, 'Enregistrer mon parcours maintenant'));
  row.append(el('button', { class: 'btn ghost', onclick: openFile }, 'Ouvrir mon fichier'));
  row.append(el('button', { class: 'btn ghost', onclick: () => showInfo(true) }, 'Revoir les informations importantes'));
  main.append(row);
  state.bienvenueVue = true; persistLocal();
}

function stepHeader(id, steps, idx) {
  const t = taches[id];
  const bar = steps.map((s, i) => `<a href="#/${id}/${i}" class="seg ${i < idx ? 'done' : i === idx ? 'now' : ''}" title="${esc(s.titre.replace(/[*_]/g, ''))}" aria-label="Étape ${i + 1} : ${esc(s.titre.replace(/[*_]/g, ''))}"></a>`).join('');
  return el('header', { class: 'step-head' }, `
    <span class="eyebrow">${esc(tacheLabel(t))} · étape ${idx + 1} / ${steps.length}</span>
    <nav class="segbar" aria-label="Étapes">${bar}</nav>`);
}

function renderStep(main, id, idx) {
  const t = taches[id];
  const steps = stepsOf(id);
  if (idx >= steps.length) return renderEnd(main, id);
  idx = Math.max(0, idx);
  state.etapes[id] = idx; persistLocal();
  const step = steps[idx];
  main.append(stepHeader(id, steps, idx));

  if (step.intro) {
    main.append(el('section', { class: 'tache-hero' }, `
      ${motif(id, 'hero-motif')}
      <div>
        <h1>${mdInline(t.titre)}</h1>
        <p class="chips"><span>${esc(t.duree)}</span><span>${esc(t.modalite)}</span></p>
        <p class="result">${esc(t.resultat)}</p>
      </div>`));
  }
  for (const b of step.blocs) {
    const node = renderBlock(b);
    if (!node) continue;
    if (REDACTION) node.prepend(el('div', { class: 'redac-tag' }, `${esc(b.type)} · <code>${esc(b.id)}</code>${b.statut_contenu ? ` · <mark>${esc(b.statut_contenu)}</mark>` : ''}`));
    main.append(node);
  }

  const foot = el('footer', { class: 'step-foot' });
  const prev = idx > 0 ? el('a', { class: 'btn ghost', href: `#/${id}/${idx - 1}` }, '← Retour') : el('span');
  const status = el('span', { class: 'foot-mid' });
  status.append(el('span', { 'data-save-status': '' }), el('button', { class: 'btn save small foot-save', onclick: save }, 'Enregistrer'));
  const nextLabel = idx === steps.length - 1 ? 'Terminer la tâche' : idx === 0 ? 'Commencer' : 'Continuer';
  const next = el('a', { class: 'btn primary', href: `#/${id}/${idx + 1}` }, `${nextLabel} →`);
  foot.append(prev, status, next);
  main.append(foot);
  updateSaveStatus();
}

function renderEnd(main, id) {
  const t = taches[id];
  const idx = parcours.taches.indexOf(id);
  const next = parcours.taches[idx + 1];
  main.append(el('section', { class: 'end-card' }, `
    ${motif(id, 'hero-motif')}
    <h1>${esc(tacheLabel(t))} terminée</h1>
    <p class="lead">Prenez un instant pour enregistrer votre parcours dans votre fichier.</p>`));
  const row = el('div', { class: 'row center' });
  row.append(el('button', { class: 'btn primary', onclick: save }, 'Enregistrer mon parcours'));
  row.append(next
    ? el('a', { class: 'btn ghost', href: `#/${next}/${state.etapes[next] || 0}` }, `${tacheLabel(taches[next])} →`)
    : el('a', { class: 'btn ghost', href: '#/dossier' }, 'Voir mon dossier →'));
  main.append(row);
  main.append(el('p', { class: 'center muted' }, '<span data-save-status></span>'));
  updateSaveStatus();
}

// ---------------------------------------------------------------------------
// Blocs
// ---------------------------------------------------------------------------
function renderBlock(b) {
  switch (b.type) {
    case 'texte': return blockTexte(b);
    case 'consigne': return blockConsigne(b);
    case 'reponse': return blockReponse(b);
    case 'tableau': return blockTableau(b);
    case 'tri': return blockTri(b);
    case 'autocontrole': return blockAutocontrole(b);
    case 'externe': return blockExterne(b);
    case 'lehrplan': return blockLehrplan(b);
    case 'repere': return blockRepere(b);
    case 'rappel': return blockRappel(b);
    case 'silhouette': return blockSilhouette(b);
    case 'carte': return blockCarte(b);
    case 'audio': return blockAudio(b);
    case 'schema': return blockSchema(b);
    case 'remise': return blockRemise(b);
    case 'mindmap': return blockMindmap(b);
    case 'extrait': return blockExtrait(b);
    default: return REDACTION ? el('div', { class: 'card' }, `Type inconnu : ${esc(b.type)}`) : null;
  }
}

function blockTexte(b) {
  const minutes = Math.max(1, Math.round(countWords(b.corps) / 180));
  const head = b.titre ? `<h3>${esc(b.titre)}</h3>` : '';
  if (b.repliable) {
    return el('details', { class: 'reading soft' }, `<summary>${esc(b.titre)}</summary><div class="prose">${md(b.corps)}</div>`);
  }
  const long = countWords(b.corps) > 120;
  return el('section', { class: 'reading' + (long ? ' long' : '') }, `${head}${long ? `<p class="meta-line">Lecture · ${minutes} min</p>` : ''}<div class="prose">${md(b.corps)}</div>`);
}

function blockConsigne(b) {
  const chips = [b.duree, b.modalite].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  const sec = el('section', { class: 'consigne', id: b.id });
  sec.innerHTML = `
    <h2>${mdInline(b.titre)}</h2>
    ${b.accroche ? `<p class="accroche">${mdInline(b.accroche)}</p>` : ''}
    ${chips ? `<p class="chips">${chips}</p>` : ''}`;
  if (b.corps) {
    if (b.repliee) sec.append(el('details', { class: 'soft' }, `<summary>Consigne détaillée</summary><div class="prose">${md(b.corps)}</div>`));
    else sec.append(el('div', { class: 'prose' }, md(b.corps)));
  }
  return sec;
}

function blockReponse(b) {
  const wrap = el('section', { class: 'answer' + (b.prive ? ' private' : '') });
  wrap.append(el('label', { for: `f-${b.id}` }, `${mdInline(b.label)}${b.prive ? ' <span class="badge">espace privé</span>' : ''}`));
  const rows = b.longueur === 'court' ? 2 : b.longueur === 'moyen' ? 4 : 7;
  const longHelp = (b.aide || '').length > 70;
  if (longHelp) wrap.append(el('p', { class: 'answer-help' }, mdInline(b.aide)));
  const ta = el('textarea', { id: `f-${b.id}`, rows, placeholder: longHelp ? '' : (b.aide || '') });
  ta.value = getA(b.id, '');
  const info = el('div', { class: 'answer-info' });
  const updInfo = () => {
    const n = countWords(ta.value);
    if (b.mots_cible) {
      const ok = n >= b.mots_cible * 0.8 && n <= b.mots_cible * 1.3;
      info.innerHTML = `<span class="${ok ? 'ok' : ''}">${n} / ~${b.mots_cible} mots</span>`;
    } else info.textContent = n ? `${n} mot${n > 1 ? 's' : ''}` : '';
  };
  ta.addEventListener('input', () => { setA(b.id, ta.value); updInfo(); autoGrow(ta); });
  updInfo();
  wrap.append(ta, info);
  if (b.prive) wrap.append(el('p', { class: 'hint' }, 'Reste sur cet ordinateur. N’entre dans votre fichier ou votre dossier que si vous le décidez.'));
  requestAnimationFrame(() => autoGrow(ta));
  return wrap;
}
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 48) + 'px'; }

function blockTableau(b) {
  const wrap = el('section', { class: 'answer' });
  wrap.append(el('label', {}, esc(b.label)));
  const data = getA(b.id, null) || Array.from({ length: b.lignes || 3 }, () => b.colonnes.map(() => ''));
  const table = el('table', { class: 'grid' });
  table.innerHTML = `<thead><tr>${b.colonnes.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`;
  const tb = el('tbody');
  for (const ex of b.exemples || []) tb.append(el('tr', { class: 'example' }, ex.map((c) => `<td>${esc(c)}</td>`).join('')));
  const persist = () => setA(b.id, data.map((r) => [...r]));
  const addRow = (row, ri) => {
    const tr = el('tr');
    row.forEach((val, ci) => {
      const td = el('td');
      const ta = el('textarea', { rows: 2, 'aria-label': `${b.colonnes[ci]}, ligne ${ri + 1}` });
      ta.value = val;
      ta.addEventListener('input', () => { data[ri][ci] = ta.value; persist(); autoGrow(ta); });
      requestAnimationFrame(() => autoGrow(ta));
      td.append(ta);
      tr.append(td);
    });
    tb.append(tr);
  };
  data.forEach(addRow);
  table.append(tb);
  const tw = el('div', { class: 'table-wrap' });
  tw.append(table);
  wrap.append(tw);
  wrap.append(el('button', { class: 'link', onclick: () => { const r = b.colonnes.map(() => ''); data.push(r); addRow(r, data.length - 1); persist(); } }, '+ une ligne'));
  return wrap;
}

function blockTri(b) {
  const wrap = el('section', { class: 'tri' });
  const st = getA(b.id, null) || { placements: {}, ajouts: [], verifie: false };
  const commit = () => setA(b.id, JSON.parse(JSON.stringify(st)));
  let selected = null;
  let selectedOwn = null;

  const draw = () => {
    wrap.innerHTML = `<p class="tri-consigne">${mdInline(b.consigne)}</p>`;
    const pool = el('div', { class: 'tri-pool', 'data-cat': '' });
    const arbre = b.visuel === 'arbre' && b.categories.length === 2;
    const cats = el('div', arbre ? { class: 'tri-arbre' } : { class: 'tri-cats', style: `--n:${b.categories.length}` });
    const boxes = {};
    b.categories.forEach((c, ci) => {
      const box = el('div', { class: `tri-cat tone-${ci % 3}${arbre ? (ci === 0 ? ' couronne' : ' racines') : ''}`, 'data-cat': c.id }, `<h4>${esc(c.label)}</h4>`);
      boxes[c.id] = box;
      cats.append(box);
      if (arbre && ci === 0) cats.append(el('div', { class: 'arbre-sol', 'aria-hidden': 'true' }, ARBRE_SOL));
    });
    const drop = (catId, idx) => {
      if (catId) st.placements[idx] = catId; else delete st.placements[idx];
      st.verifie = false; selected = null; commit(); draw();
    };
    b.elements.forEach((item, i) => {
      const placed = st.placements[i];
      let cls = 'chip';
      let note = '';
      let mark = '';
      if (st.verifie && placed) {
        const both = item.solution === 'les-deux';
        const ok = both || item.solution === placed;
        cls += both ? ' both' : ok ? ' right' : ' wrong';
        mark = both ? '⇄ ' : ok ? '✓ ' : '↺ ';
        if (item.explication && (both || !ok)) note = item.explication;
      }
      if (selected === i) cls += ' selected';
      const chip = el('button', { class: cls, draggable: 'true', type: 'button' }, `${mark}${esc(item.texte)}${note ? `<span class="why">${esc(note)}</span>` : ''}`);
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (placed && selectedOwn) { st.ajouts.push({ texte: selectedOwn, cat: placed }); selectedOwn = null; commit(); draw(); return; }
        if (placed && selected !== null && selected !== i) { drop(placed, selected); return; }
        if (placed) { delete st.placements[i]; st.verifie = false; selected = null; commit(); draw(); return; }
        selected = selected === i ? null : i; draw();
      });
      chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
      (placed && boxes[placed] ? boxes[placed] : pool).append(chip);
    });
    st.ajouts.forEach((a, ai) => {
      if (!boxes[a.cat]) return;
      const c = el('button', { type: 'button', class: 'chip own', title: 'Cliquer pour retirer' }, esc(a.texte));
      c.addEventListener('click', (e) => { e.stopPropagation(); st.ajouts.splice(ai, 1); commit(); draw(); });
      boxes[a.cat].append(c);
    });
    [pool, ...Object.values(boxes)].forEach((zone) => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        const v = e.dataTransfer.getData('text/plain');
        if (v.startsWith('own:')) { if (zone.dataset.cat) { st.ajouts.push({ texte: v.slice(4), cat: zone.dataset.cat }); commit(); draw(); } return; }
        drop(zone.dataset.cat, Number(v));
      });
      zone.addEventListener('click', () => {
        if (selectedOwn && zone.dataset.cat) { st.ajouts.push({ texte: selectedOwn, cat: zone.dataset.cat }); selectedOwn = null; commit(); draw(); return; }
        if (selected !== null) drop(zone.dataset.cat, selected);
      });
    });
    if (pool.children.length) wrap.append(pool);
    if (b.mots_de) {
      const used = new Set(st.ajouts.map((a) => a.texte));
      const words = mmWords(b.mots_de).filter((w) => !used.has(w));
      const box = el('div', { class: 'tri-own' });
      box.append(el('p', { class: 'tri-own-t' }, words.length ? 'Vos mots de la carte mentale — placez-les aussi :' : (mmWords(b.mots_de).length ? 'Tous vos mots de la carte mentale sont placés.' : 'Votre carte mentale est encore vide — vous pourrez y revenir.')));
      words.forEach((w) => {
        const c = el('button', { type: 'button', class: 'chip own-src' + (selectedOwn === w ? ' selected' : ''), draggable: 'true' }, esc(w));
        c.addEventListener('click', (e) => { e.stopPropagation(); selectedOwn = selectedOwn === w ? null : w; selected = null; draw(); });
        c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'own:' + w));
        box.append(c);
      });
      wrap.append(box);
    }
    else if (!st.verifie) wrap.append(el('p', { class: 'hint' }, 'Tout est placé.'));
    wrap.append(cats);

    const bar = el('div', { class: 'row' });
    const allPlaced = Object.keys(st.placements).length === b.elements.length;
    if (allPlaced && !st.verifie) bar.append(el('button', { class: 'btn primary', onclick: () => { st.verifie = true; commit(); draw(); } }, 'Comparer avec notre proposition'));
    if (Object.keys(st.placements).length) bar.append(el('button', { class: 'link', onclick: () => { st.placements = {}; st.verifie = false; commit(); draw(); } }, 'Tout reprendre'));
    wrap.append(bar);
    if (st.verifie) {
      wrap.append(el('p', { class: 'feedback' }, '<span>✓ proche de notre proposition</span><span>↺ à reconsidérer</span><span>⇄ les deux sont possibles</span><em>Une proposition, pas une vérité : discutez les écarts.</em>'));
    }
    if (b.ajout_libre) {
      const f = el('form', { class: 'add-own' });
      const inp = el('input', { type: 'text', placeholder: 'Mon propre exemple…', 'aria-label': 'Mon propre exemple' });
      const sel = el('select', { 'aria-label': 'Catégorie' }, b.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join(''));
      f.append(inp, sel, el('button', { class: 'btn ghost small', type: 'submit' }, 'Ajouter'));
      f.addEventListener('submit', (e) => { e.preventDefault(); if (!inp.value.trim()) return; st.ajouts.push({ texte: inp.value.trim(), cat: sel.value }); commit(); draw(); });
      wrap.append(f);
      if (st.ajouts.length) wrap.append(el('p', { class: 'hint' }, 'Vos propres mots (bordure pointillée) se retirent d’un clic.'));
    }
  };
  draw();
  return wrap;
}

const ARBRE_SOL = `<svg viewBox="0 0 220 96" class="tronc">
  <path d="M98 0 C 100 34, 96 58, 100 70 L 120 70 C 124 58, 120 34, 122 0 Z" style="fill:var(--m1);fill-opacity:.9"/>
  <path d="M104 70 C 86 80, 58 86, 20 94 M110 70 C 110 80, 109 88, 110 96 M116 70 C 134 80, 162 86, 200 94" style="stroke:var(--m2)" stroke-width="5" fill="none" stroke-linecap="round" opacity=".85"/>
</svg><span class="sol-ligne"></span><span class="sol-label">surface</span>`;

function blockAutocontrole(b) {
  const wrap = el('details', { class: 'check' });
  const st = getA(b.id, null) || { coches: [], vu: false };
  const done = () => b.points.filter((_, i) => st.coches[i]).length;
  const sum = el('summary', {}, '');
  const updSum = () => { sum.innerHTML = `<span class="check-title">Regard sur mon travail</span><span class="check-count">${done()} / ${b.points.length}</span>`; };
  updSum();
  wrap.append(sum);
  const ul = el('ul');
  b.points.forEach((p, i) => {
    const li = el('li');
    const id = `c-${b.id}-${i}`;
    const cb = el('input', { type: 'checkbox', id });
    cb.checked = !!st.coches[i];
    cb.addEventListener('change', () => { st.coches[i] = cb.checked; setA(b.id, { ...st }); updSum(); });
    li.append(cb, el('label', { for: id }, mdInline(p)));
    ul.append(li);
  });
  wrap.append(ul);
  if (b.exemple) {
    const box = el('div', { class: 'example-box prose', hidden: !st.vu }, `<h4>${esc(b.exemple_titre || 'Un regard possible')}</h4>${md(b.exemple)}<p class="hint">Un regard parmi d’autres — pour comparer, pas pour copier.</p>`);
    const btn = el('button', { class: 'link' }, st.vu ? 'Masquer' : 'Voir un regard possible');
    btn.addEventListener('click', () => {
      st.vu = box.hidden; box.hidden = !box.hidden;
      btn.textContent = box.hidden ? 'Voir un regard possible' : 'Masquer';
      setA(b.id, { ...st });
    });
    wrap.append(btn, box);
  }
  return wrap;
}

function blockExterne(b) {
  const links = (b.liens || []).map((l) => (l.url
    ? `<a class="btn ghost small" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`
    : `<span class="btn ghost small disabled" title="Le lien sera ajouté prochainement">${esc(l.label)} · lien à venir</span>`)).join(' ');
  return el('aside', { class: 'aside external' }, `<p class="aside-kicker">Hors de l’application</p><h3>${esc(b.titre)}</h3><div class="prose">${md(b.corps)}</div><div class="row">${links}</div>`);
}

function blockLehrplan(b) {
  const wrap = el('aside', { class: 'aside lp' }, `<p class="aside-kicker">Plan d’études</p><h3>${esc(b.titre)}</h3>${b.corps ? `<div class="prose">${md(b.corps)}</div>` : ''}`);
  const row = el('div', { class: 'row' });
  for (const l of b.liens || []) {
    const url = l.recherche ? LP_SEARCH(l.recherche) : l.url;
    if (url) row.append(el('button', { class: 'btn ghost small', onclick: () => openLP(url) }, esc(l.label)));
  }
  wrap.append(row);
  return wrap;
}

function blockRepere(b) {
  const links = (b.liens || []).filter((l) => l.url).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');
  return el('aside', { class: 'aside repere' }, `<p class="aside-kicker">Pour aller plus loin</p><h3>${esc(b.titre.replace(/^Pour aller plus loin : /, ''))}</h3><div class="prose">${md(b.corps)}</div><p class="tags">${links}</p>${b.source ? `<p class="hint">${esc(b.source)}</p>` : ''}`);
}

function blockRappel(b) {
  const srcB = allBlocks().find((x) => x.id === b.source);
  let v = getA(b.source, '');
  if (srcB && srcB.type === 'mindmap') v = mmWords(b.source).join(' · ');
  if (typeof v !== 'string') v = '';
  return el('aside', { class: 'aside recall' }, `<p class="aside-kicker">Retour en arrière</p><h3>${esc(b.titre)}</h3>
    <blockquote>${v ? esc(v).replace(/\n/g, '<br>') : '<em>Aucune note pour l’instant.</em>'}</blockquote>
    ${b.corps ? `<div class="prose">${md(b.corps)}</div>` : ''}`);
}

const SILHOUETTE_SVG = `<svg viewBox="0 0 200 400" aria-hidden="true" class="sil-fig"><g style="fill:var(--sil)">
<circle cx="100" cy="50" r="33"/>
<path d="M84 92 Q100 99 116 92 C138 95 150 104 154 122 L166 214 Q168 228 156 229 Q145 229 144 216 L137 152 L135 238 L132 380 Q131 393 118 393 Q106 393 105 380 L102 262 L98 262 L95 380 Q94 393 82 393 Q69 393 68 380 L65 238 L63 152 L56 216 Q55 229 44 229 Q32 228 34 214 L46 122 C50 104 62 95 84 92 Z"/></g></svg>`;

function blockSilhouette(b) {
  const wrap = el('section', { class: 'answer private' });
  wrap.append(el('label', {}, 'Ma silhouette <span class="badge">espace privé</span>'));
  const st = getA(b.id, null) || { mots: [], liens: [] };
  st.liens = st.liens || [];
  let seq = 0;
  st.mots.forEach((m) => { if (!m.id) m.id = 'm' + Math.random().toString(36).slice(2, 8); });
  let linkFrom = null; let linkMode = false;
  const stage = el('div', { class: 'sil-stage' }, SILHOUETTE_SVG);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sil-links'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
  stage.append(svg);
  const commit = () => setA(b.id, { mots: st.mots.map((m) => ({ ...m })), liens: st.liens.map((l) => [...l]) });
  const center = (m) => { const n = stage.querySelector(`[data-mid="${m.id}"]`); if (!n) return [m.x, m.y]; const r = stage.getBoundingClientRect(); const q = n.getBoundingClientRect(); return [((q.left + q.width / 2 - r.left) / r.width) * 100, ((q.top + q.height / 2 - r.top) / r.height) * 100]; };
  const drawLinks = () => {
    svg.innerHTML = '';
    st.liens = st.liens.filter(([a, c]) => st.mots.find((m) => m.id === a) && st.mots.find((m) => m.id === c));
    for (const [a, c] of st.liens) {
      const [x1, y1] = center(st.mots.find((m) => m.id === a)); const [x2, y2] = center(st.mots.find((m) => m.id === c));
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      svg.append(l);
    }
  };
  const place = (m) => {
    const w = el('span', { class: 'sil-word' + (linkFrom === m.id ? ' linking' : ''), 'data-mid': m.id, style: `left:${m.x}%;top:${m.y}%` }, `${esc(m.texte)}<button type="button" aria-label="Supprimer">×</button>`);
    w.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); st.mots = st.mots.filter((x) => x.id !== m.id); commit(); redraw(); });
    w.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      if (linkMode) {
        if (!linkFrom) { linkFrom = m.id; redraw(); return; }
        if (linkFrom !== m.id && !st.liens.some(([a, c]) => (a === linkFrom && c === m.id) || (a === m.id && c === linkFrom))) st.liens.push([linkFrom, m.id]);
        linkFrom = null; commit(); redraw(); return;
      }
      w.setPointerCapture(e.pointerId);
      const r = stage.getBoundingClientRect();
      const move = (ev) => {
        m.x = Math.min(95, Math.max(0, ((ev.clientX - r.left) / r.width) * 100));
        m.y = Math.min(96, Math.max(0, ((ev.clientY - r.top) / r.height) * 100));
        w.style.left = m.x + '%'; w.style.top = m.y + '%';
        drawLinks();
      };
      const up = () => { w.removeEventListener('pointermove', move); w.removeEventListener('pointerup', up); commit(); };
      w.addEventListener('pointermove', move);
      w.addEventListener('pointerup', up);
    });
    stage.append(w);
  };
  const redraw = () => { stage.querySelectorAll('.sil-word').forEach((n) => n.remove()); st.mots.forEach(place); requestAnimationFrame(drawLinks); stage.classList.toggle('link-mode', linkMode); };
  const f = el('form', { class: 'add-own' });
  const inp = el('input', { type: 'text', placeholder: 'Un mot ou une expression…', 'aria-label': 'Mot à placer' });
  f.append(inp, el('button', { class: 'btn ghost small', type: 'submit' }, 'Ajouter'));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!inp.value.trim()) return;
    st.mots.push({ id: 'm' + Date.now().toString(36) + (seq++), texte: inp.value.trim(), x: 2 + (st.mots.length % 3) * 3, y: 4 + (st.mots.length % 10) * 8 });
    inp.value = ''; commit(); redraw();
  });
  const tools = el('div', { class: 'row' });
  const linkBtn = el('button', { type: 'button', class: 'btn ghost small' }, 'Relier deux mots');
  linkBtn.addEventListener('click', () => { linkMode = !linkMode; linkFrom = null; linkBtn.textContent = linkMode ? 'Terminer les liens' : 'Relier deux mots'; linkBtn.classList.toggle('on', linkMode); redraw(); });
  const clear = el('button', { type: 'button', class: 'link' }, 'Effacer les liens');
  clear.addEventListener('click', () => { st.liens = []; commit(); redraw(); });
  tools.append(linkBtn, clear, el('span', { class: 'hint' }, 'Liens : cliquez sur un mot, puis sur un autre.'));
  wrap.append(f, tools, stage, el('p', { class: 'hint' }, 'Faites glisser les mots sur la silhouette ou autour d’elle. Il n’existe pas de placement correct.'));
  requestAnimationFrame(redraw);
  return wrap;
}

function blockCarte(b) {
  const wrap = el('section', { class: 'answer' });
  const render = () => {
    const parts = b.champs.map((id) => {
      const blk = allBlocks().find((x) => x.id === id);
      return `<div class="carte-field"><h4>${esc(blk ? blk.label : id)}</h4><p>${esc(getA(id, '') || '…').replace(/\n/g, '<br>')}</p></div>`;
    }).join('');
    return `<div class="carte">${motif('t4', 'carte-motif')}<div class="carte-head">${esc(b.titre)}</div>${parts}</div>`;
  };
  wrap.innerHTML = `<label>Aperçu de la carte</label><div class="carte-slot">${render()}</div>`;
  const onChange = (e) => {
    if (!wrap.isConnected) { document.removeEventListener('answer-change', onChange); return; }
    if (b.champs.includes(e.detail)) wrap.querySelector('.carte-slot').innerHTML = render();
  };
  document.addEventListener('answer-change', onChange);
  wrap.append(el('div', { class: 'row' }, ''));
  wrap.lastChild.append(el('button', { class: 'btn ghost small', onclick: () => printHTML(render(), 'print-carte') }, 'Imprimer la carte'));
  return wrap;
}


const SCHEMAS = {
  'tete-coeur-main': () => `
<svg viewBox="0 0 640 430" role="img" aria-labelledby="sch-t sch-d" class="schema-svg">
  <title id="sch-t">Les trois dimensions de la compétence interculturelle</title>
  <desc id="sch-d">Trois cercles qui se chevauchent : les connaissances (la tête), les attitudes (le cœur) et les capacités d’agir (la main). Leur zone commune représente la compétence interculturelle.</desc>
  <circle cx="320" cy="150" r="128" style="fill:var(--m1);fill-opacity:.22;stroke:var(--m1);stroke-width:2.5"/>
  <circle cx="232" cy="290" r="128" style="fill:var(--m3);fill-opacity:.32;stroke:var(--m3);stroke-width:2.5"/>
  <circle cx="408" cy="290" r="128" style="fill:var(--m2);fill-opacity:.22;stroke:var(--m2);stroke-width:2.5"/>
  <circle cx="320" cy="245" r="46" class="sch-disc" style="fill:var(--surface);fill-opacity:.92"/>
  <text x="320" y="240" text-anchor="middle" class="sch-center">compétence</text>
  <text x="320" y="258" text-anchor="middle" class="sch-center">interculturelle</text>
  <text x="320" y="78" text-anchor="middle" class="sch-h">la tête</text>
  <text x="320" y="102" text-anchor="middle" class="sch-t">Connaissances</text>
  <text x="320" y="122" text-anchor="middle" class="sch-s">pratiques, contextes,</text>
  <text x="320" y="140" text-anchor="middle" class="sch-s">références des personnes</text>
  <text x="178" y="312" text-anchor="middle" class="sch-h">le cœur</text>
  <text x="178" y="336" text-anchor="middle" class="sch-t">Attitudes</text>
  <text x="178" y="356" text-anchor="middle" class="sch-s">curiosité, ouverture,</text>
  <text x="178" y="374" text-anchor="middle" class="sch-s">questionner ses évidences</text>
  <text x="462" y="312" text-anchor="middle" class="sch-h">la main</text>
  <text x="462" y="336" text-anchor="middle" class="sch-t">Capacités d’agir</text>
  <text x="462" y="356" text-anchor="middle" class="sch-s">clarifier, communiquer,</text>
  <text x="462" y="374" text-anchor="middle" class="sch-s">se comprendre</text>
</svg>`,
};
function blockSchema(b) {
  const draw = SCHEMAS[b.modele];
  if (!draw) return REDACTION ? el('div', { class: 'aside' }, `Schéma inconnu : ${esc(b.modele)}`) : null;
  return el('figure', { class: 'schema' }, `${draw()}${b.legende ? `<figcaption>${mdInline(b.legende)}</figcaption>` : ''}`);
}

function blockRemise(b) {
  const link = b.url
    ? `<a class="btn save" href="${esc(b.url)}" target="_blank" rel="noopener">Ouvrir la remise sur ILIAS ↗</a>`
    : `<span class="muted">${REDACTION ? '<span class="badge">lien ILIAS à compléter</span>' : 'Le lien vers ILIAS sera indiqué ici.'}</span>`;
  const wrap = el('aside', { class: 'aside remise' }, `<p class="aside-kicker">À remettre sur ILIAS</p><h3>${esc(b.titre)}</h3>
    ${b.echeance ? `<p class="chips"><span>Délai : ${esc(b.echeance)}</span></p>` : ''}
    ${b.corps ? `<div class="prose">${md(b.corps)}</div>` : ''}`);
  const row = el('div', { class: 'row' }, link);
  row.append(el('a', { class: 'btn ghost small', href: '#/dossier' }, 'Préparer le PDF dans mon dossier'));
  wrap.append(row);
  return wrap;
}

// ---------------------------------------------------------------------------
// Carte mentale : mots, branches, glisser-déposer
// ---------------------------------------------------------------------------
const mmWords = (id) => ((getA(id, null) || {}).noeuds || []).filter((n) => n.parent !== null && n.texte.trim()).map((n) => n.texte.trim());
function mmDepth(nodes, n) { let d = 0; let p = n; while (p && p.parent !== null) { p = nodes.find((x) => x.id === p.parent); d++; } return d; }

function blockMindmap(b) {
  const wrap = el('section', { class: 'answer mindmap' + (b.prive ? ' private' : '') });
  wrap.append(el('label', {}, `${esc(b.label || 'Ma carte mentale')}${b.prive ? ' <span class="badge">espace privé</span>' : ''}`));
  const st = getA(b.id, null) || { noeuds: [{ id: 'c', texte: b.centre || 'Moi', x: 50, y: 50, parent: null }] };
  st.noeuds[0].texte = b.centre || st.noeuds[0].texte;
  let sel = 'c';
  let seq = st.noeuds.reduce((m, n) => Math.max(m, parseInt(String(n.id).replace(/\D/g, ''), 10) || 0), 0);
  const commit = () => setA(b.id, { noeuds: st.noeuds.map((n) => ({ ...n })) });

  const bar = el('form', { class: 'mm-bar' });
  const inp = el('input', { type: 'text', placeholder: 'Un mot ou une idée…', 'aria-label': 'Nouveau mot' });
  const addBtn = el('button', { class: 'btn primary small', type: 'submit' }, '+ Ajouter');
  const hint = el('span', { class: 'mm-hint' });
  bar.append(inp, addBtn, hint);
  const stage = el('div', { class: 'mm-stage' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mm-lines');
  stage.append(svg);
  const tools = el('div', { class: 'mm-tools' });

  const byId = (id) => st.noeuds.find((n) => n.id === id);
  const place = (parent) => {
    const kids = st.noeuds.filter((n) => n.parent === parent.id).length;
    if (parent.parent === null) {
      const a = (kids * 2 * Math.PI) / 7 - Math.PI / 2 + 0.35;
      return { x: 50 + Math.cos(a) * 30, y: 50 + Math.sin(a) * 34 };
    }
    const dx = parent.x - 50; const dy = parent.y - 50;
    const base = Math.atan2(dy, dx);
    const a = base + (kids % 2 ? 1 : -1) * (0.45 + 0.3 * Math.floor(kids / 2));
    return { x: parent.x + Math.cos(a) * 15, y: parent.y + Math.sin(a) * 17 };
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const draw = () => {
    stage.querySelectorAll('.mm-node').forEach((n) => n.remove());
    const r = stage.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${r.width || 600} ${r.height || 420}`);
    svg.innerHTML = '';
    const W = r.width || 600; const H = r.height || 420;
    for (const n of st.noeuds) {
      if (n.parent === null) continue;
      const p = byId(n.parent); if (!p) continue;
      const x1 = (p.x / 100) * W; const y1 = (p.y / 100) * H; const x2 = (n.x / 100) * W; const y2 = (n.y / 100) * H;
      const mx = (x1 + x2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
      path.setAttribute('class', `mm-line d${Math.min(mmDepth(st.noeuds, n), 3)}`);
      svg.append(path);
    }
    for (const n of st.noeuds) {
      const d = mmDepth(st.noeuds, n);
      const node = el('button', { type: 'button', class: `mm-node d${Math.min(d, 3)}${n.id === sel ? ' sel' : ''}`, style: `left:${n.x}%;top:${n.y}%` }, esc(n.texte));
      node.addEventListener('pointerdown', (e) => {
        const start = { x: e.clientX, y: e.clientY }; let moved = false;
        node.setPointerCapture(e.pointerId);
        const rr = stage.getBoundingClientRect();
        const move = (ev) => {
          if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
          moved = true;
          n.x = clamp(((ev.clientX - rr.left) / rr.width) * 100, 4, 96);
          n.y = clamp(((ev.clientY - rr.top) / rr.height) * 100, 5, 95);
          node.style.left = n.x + '%'; node.style.top = n.y + '%';
          drawLinesOnly();
        };
        const up = () => {
          node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up);
          if (moved) commit(); else { sel = n.id; draw(); inp.focus(); }
        };
        node.addEventListener('pointermove', move); node.addEventListener('pointerup', up);
      });
      stage.append(node);
    }
    const s = byId(sel) || st.noeuds[0];
    hint.textContent = s.parent === null ? `Nouvelle branche depuis « ${s.texte} »` : `Nouvelle branche depuis « ${s.texte} »`;
    tools.innerHTML = '';
    if (s.parent !== null) {
      const ren = el('button', { type: 'button', class: 'link' }, 'Renommer');
      ren.addEventListener('click', () => { const t = prompt('Nouveau texte :', s.texte); if (t && t.trim()) { s.texte = t.trim(); commit(); draw(); } });
      const del = el('button', { type: 'button', class: 'link' }, 'Supprimer (avec ses branches)');
      del.addEventListener('click', () => {
        const drop = new Set([s.id]); let grew = true;
        while (grew) { grew = false; for (const n of st.noeuds) if (!drop.has(n.id) && drop.has(n.parent)) { drop.add(n.id); grew = true; } }
        st.noeuds = st.noeuds.filter((n) => !drop.has(n.id)); sel = 'c'; commit(); draw();
      });
      tools.append(el('span', { class: 'muted' }, `« ${esc(s.texte)} » :`), ren, del);
    } else {
      tools.append(el('span', { class: 'muted' }, 'Cliquez sur un mot pour y ajouter une branche. Faites glisser les mots pour les déplacer.'));
    }
  };
  const drawLinesOnly = () => {
    const r = stage.getBoundingClientRect(); const W = r.width; const H = r.height;
    const paths = svg.querySelectorAll('path'); let i = 0;
    for (const n of st.noeuds) {
      if (n.parent === null) continue;
      const p = byId(n.parent); if (!p) continue;
      const x1 = (p.x / 100) * W; const y1 = (p.y / 100) * H; const x2 = (n.x / 100) * W; const y2 = (n.y / 100) * H; const mx = (x1 + x2) / 2;
      if (paths[i]) paths[i].setAttribute('d', `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
      i++;
    }
  };
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = inp.value.trim(); if (!t) return;
    const parent = byId(sel) || st.noeuds[0];
    const pos = place(parent);
    const n = { id: 'n' + (++seq), texte: t, x: clamp(pos.x, 12, 88), y: clamp(pos.y, 8, 92), parent: parent.id };
    st.noeuds.push(n); inp.value = ''; commit(); draw(); inp.focus();
  });
  wrap.append(bar, stage, tools);
  requestAnimationFrame(draw);
  window.addEventListener('resize', () => { if (wrap.isConnected) draw(); });
  return wrap;
}

// Extrait d’un texte précédent (paragraphes ¶)
function blockExtrait(b) {
  const src = allBlocks().find((x) => x.id === b.source);
  if (!src) return null;
  const paras = (src.corps || '').split(/\n\s*\n/);
  const pick = paras.filter((p) => (b.paragraphes || []).some((n) => p.trim().startsWith(`**¶${n}**`)));
  if (!pick.length) return null;
  return el('aside', { class: 'aside extrait' }, `<p class="aside-kicker">${esc(b.titre || 'Rappel du texte')}</p><div class="prose">${md(pick.join('\n\n'))}</div>`);
}

function fmtTime(t) { t = Math.max(0, Math.round(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
function blockAudio(b) {
  if (!b.fichier) return REDACTION ? el('div', { class: 'aside' }, 'Audio : fichier manquant') : null;
  const wrap = el('section', { class: 'audio' });
  const audio = el('audio', { src: b.fichier, preload: 'metadata' });
  const btn = el('button', { class: 'audio-btn', type: 'button', 'aria-label': 'Lire' }, '<span class="ic play"></span>');
  const bar = el('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Position', class: 'audio-bar' });
  const time = el('span', { class: 'audio-time' }, '0:00');
  const body = el('div', { class: 'audio-body' }, `<p class="audio-title">${esc(b.titre || 'Écouter')}</p>`);
  const ctrl = el('div', { class: 'audio-ctrl' });
  ctrl.append(bar, time);
  body.append(ctrl);
  if (b.legende) body.append(el('p', { class: 'hint' }, esc(b.legende)));
  btn.addEventListener('click', () => {
    document.querySelectorAll('audio').forEach((a) => { if (a !== audio) a.pause(); });
    if (audio.paused) audio.play(); else audio.pause();
  });
  const setIc = () => { btn.innerHTML = `<span class="ic ${audio.paused ? 'play' : 'pause'}"></span>`; btn.setAttribute('aria-label', audio.paused ? 'Lire' : 'Pause'); };
  audio.addEventListener('play', setIc);
  audio.addEventListener('pause', setIc);
  audio.addEventListener('ended', setIc);
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) bar.value = Math.round((audio.currentTime / audio.duration) * 1000);
    time.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
  });
  audio.addEventListener('loadedmetadata', () => { time.textContent = `0:00 / ${fmtTime(audio.duration)}`; });
  bar.addEventListener('input', () => { if (audio.duration) audio.currentTime = (bar.value / 1000) * audio.duration; });
  wrap.append(btn, body, audio);
  return wrap;
}

// ---------------------------------------------------------------------------
// Dossier
// ---------------------------------------------------------------------------
function answerHTML(b) {
  const v = state.answers[b.id];
  if (v === undefined) return '';
  if (b.type === 'reponse') return v.trim() ? `<div class="d-item"><h4>${mdInline(b.label)}</h4><p>${esc(v).replace(/\n/g, '<br>')}</p></div>` : '';
  if (b.type === 'tableau') {
    const rows = v.filter((r) => r.some((c) => c && c.trim()));
    if (!rows.length) return '';
    return `<div class="d-item"><h4>${esc(b.label)}</h4><table class="grid"><thead><tr>${b.colonnes.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  if (b.type === 'tri') {
    const lists = b.categories.map((c) => {
      const items = b.elements.filter((_, i) => v.placements?.[i] === c.id).map((x) => x.texte)
        .concat((v.ajouts || []).filter((a) => a.cat === c.id).map((a) => a.texte + ' *'));
      return `<p><strong>${esc(c.label)} :</strong> ${esc(items.join(', ') || '—')}</p>`;
    }).join('');
    return `<div class="d-item"><h4>Classement (${esc(b.categories.map((c) => c.label).join(' / '))})</h4>${lists}</div>`;
  }
  if (b.type === 'mindmap' && v.noeuds?.length > 1) {
    const list = (pid) => { const k = v.noeuds.filter((n) => n.parent === pid); return k.length ? `<ul>${k.map((n) => `<li>${esc(n.texte)}${list(n.id)}</li>`).join('')}</ul>` : ''; };
    return `<div class="d-item"><h4>${esc(b.label || 'Carte mentale')} — ${esc(v.noeuds[0].texte)}</h4>${list('c')}</div>`;
  }
  if (b.type === 'silhouette' && v.mots?.length) return `<div class="d-item"><h4>Silhouette — mots placés</h4><p>${esc(v.mots.map((m) => m.texte).join(', '))}</p></div>`;
  return '';
}
function dossierHTML() {
  const priv = privateIds();
  return parcours.taches.map((id) => {
    const t = taches[id];
    const items = t.blocs.filter((b) => ANSWER_TYPES.includes(b.type) && (!priv.has(b.id) || state.inclurePrive)).map(answerHTML).join('');
    return `<section class="d-tache"><h2>${esc(tacheLabel(t))} — ${mdInline(t.titre)}</h2>${items || '<p class="muted">Aucune réponse pour l’instant.</p>'}</section>`;
  }).join('');
}
function renderDossier(main) {
  main.append(el('section', { class: 'tache-hero' }, `${motif('dossier', 'hero-motif')}<div><h1>Mon dossier</h1>
    <p class="lead">Toutes vos réponses au même endroit — un point de départ pour votre dossier final.</p></div>`));
  const opts = el('section', { class: 'dossier-opts' });
  const lab = el('label', { class: 'toggle' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = state.inclurePrive;
  cb.addEventListener('change', () => { state.inclurePrive = cb.checked; persistLocal(); main.innerHTML = ''; renderDossier(main); });
  lab.append(cb, document.createTextNode(' Inclure mon espace privé (poème, carte « Moi », silhouette, exemple personnel) dans le dossier et dans mon fichier'));
  opts.append(lab);
  const row = el('div', { class: 'row' });
  row.append(el('button', { class: 'btn primary', onclick: () => printHTML(`<h1>${esc(parcours.titre)}</h1>${dossierHTML()}`, 'print-dossier') }, 'Imprimer ou enregistrer en PDF'));
  row.append(el('button', { class: 'btn ghost', onclick: save }, 'Enregistrer mon parcours'));
  opts.append(row);
  main.append(opts);
  main.append(el('div', { class: 'dossier' }, dossierHTML()));
}

function printHTML(html, cls) {
  const area = $('#print-area');
  area.innerHTML = html;
  document.body.classList.add('printing', cls);
  const done = () => { document.body.classList.remove('printing', cls); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

// ---------------------------------------------------------------------------
// Routeur : #/  ·  #/t1/2  ·  #/dossier
// ---------------------------------------------------------------------------
function route() {
  const main = $('#main');
  const [r, s] = location.hash.replace(/^#\/?/, '').split('/');
  main.innerHTML = '';
  main.className = '';
  document.body.classList.remove('nav-open');
  if (r === 'dossier') { renderDossier(main); renderSidebar('dossier'); }
  else if (r === 'aide') { main.className = 'step-mode'; renderAide(main); renderSidebar('aide'); }
  else if (taches[r]) {
    const idx = Number.isFinite(parseInt(s, 10)) ? parseInt(s, 10) : (state.etapes[r] || 0);
    main.className = 'step-mode';
    renderStep(main, r, idx);
    renderSidebar(r, idx);
  } else { main.className = 'home'; renderHome(main); renderSidebar(null); }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

$('#btn-save').addEventListener('click', save);
$('#btn-open').addEventListener('click', openFile);
window.addEventListener('hashchange', route);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  const [r, s] = location.hash.replace(/^#\/?/, '').split('/');
  if (!taches[r]) return;
  const i = parseInt(s, 10) || 0;
  if (e.key === 'ArrowRight') location.hash = `#/${r}/${i + 1}`;
  if (e.key === 'ArrowLeft' && i > 0) location.hash = `#/${r}/${i - 1}`;
});

(async () => {
  try {
    await loadContent();
  } catch (e) {
    $('#main').innerHTML = `<div class="aside"><h2>Le contenu n’a pas pu être chargé.</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (REDACTION) document.body.classList.add('redaction');
  updateSaveStatus();
  route();
  showInfo();
  reconnectFile();
})();

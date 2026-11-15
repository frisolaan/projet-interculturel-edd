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
const ANSWER_TYPES = ['reponse', 'tableau', 'tri', 'autocontrole', 'silhouette'];

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
      }
      await saveToHandle();
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
      if (applyFile(text)) fileHandle = h;
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
  if (!state.bienvenueVue) main.append(welcomeCard());
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


function welcomeCard() {
  const card = el('section', { class: 'welcome' }, `
    <h2>Bienvenue ! Trois choses à savoir</h2>
    <ol>
      <li><strong>Avancez étape par étape</strong> avec « Continuer ».</li>
      <li><strong>Vos réponses sont gardées dans ce navigateur</strong> — mais pas pour toujours.</li>
      <li><strong>Cliquez régulièrement sur « Enregistrer »</strong> (en haut à droite) pour garder votre parcours dans un fichier et continuer plus tard, aussi sur un autre ordinateur.</li>
    </ol>`);
  const row = el('div', { class: 'row' });
  row.append(el('a', { class: 'btn ghost small', href: '#/aide' }, 'Lire le mode d’emploi'));
  row.append(el('button', { class: 'btn primary small', onclick: () => { state.bienvenueVue = true; persistLocal(); card.remove(); } }, 'Compris'));
  card.append(row);
  return card;
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
  row.append(el('a', { class: 'btn ghost', href: '#/' }, 'Retour à l’accueil'));
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
  const ta = el('textarea', { id: `f-${b.id}`, rows, placeholder: b.aide || '' });
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
        if (placed && selected !== null && selected !== i) { drop(placed, selected); return; }
        if (placed) { delete st.placements[i]; st.verifie = false; selected = null; commit(); draw(); return; }
        selected = selected === i ? null : i; draw();
      });
      chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
      (placed && boxes[placed] ? boxes[placed] : pool).append(chip);
    });
    for (const a of st.ajouts) if (boxes[a.cat]) boxes[a.cat].append(el('span', { class: 'chip own' }, esc(a.texte)));
    [pool, ...Object.values(boxes)].forEach((zone) => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => { e.preventDefault(); drop(zone.dataset.cat, Number(e.dataTransfer.getData('text/plain'))); });
      zone.addEventListener('click', () => { if (selected !== null) drop(zone.dataset.cat, selected); });
    });
    if (pool.children.length) wrap.append(pool);
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
      if (st.ajouts.length) wrap.append(el('button', { class: 'link', onclick: () => { st.ajouts.pop(); commit(); draw(); } }, 'Retirer mon dernier exemple'));
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
    : (REDACTION ? `<span class="badge">lien à compléter : ${esc(l.label)}</span>` : `<span class="muted">${esc(l.label)}</span>`))).join(' ');
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
  const v = getA(b.source, '');
  return el('aside', { class: 'aside recall' }, `<p class="aside-kicker">Retour en arrière</p><h3>${esc(b.titre)}</h3>
    <blockquote>${v ? esc(v).replace(/\n/g, '<br>') : '<em>Aucune note pour l’instant.</em>'}</blockquote>
    ${b.corps ? `<div class="prose">${md(b.corps)}</div>` : ''}`);
}

const SILHOUETTE_SVG = `<svg viewBox="0 0 200 400" aria-hidden="true"><g fill="var(--sil)">
<circle cx="100" cy="48" r="32"/>
<path d="M60 92 Q100 82 140 92 L160 112 Q170 160 172 220 L156 222 L150 150 L146 236 Q146 300 138 388 L112 388 L104 262 L96 262 L88 388 L62 388 Q54 300 54 236 L50 150 L44 222 L28 220 Q30 160 40 112 Z"/></g></svg>`;

function blockSilhouette(b) {
  const wrap = el('section', { class: 'answer private' });
  wrap.append(el('label', {}, 'Ma silhouette <span class="badge">espace privé</span>'));
  const st = getA(b.id, null) || { mots: [] };
  const stage = el('div', { class: 'sil-stage' }, SILHOUETTE_SVG);
  const commit = () => setA(b.id, { mots: st.mots.map((m) => ({ ...m })) });
  const place = (m, i) => {
    const w = el('span', { class: 'sil-word', style: `left:${m.x}%;top:${m.y}%` }, `${esc(m.texte)}<button type="button" aria-label="Supprimer">×</button>`);
    w.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); st.mots.splice(i, 1); commit(); redraw(); });
    w.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      w.setPointerCapture(e.pointerId);
      const r = stage.getBoundingClientRect();
      const move = (ev) => {
        m.x = Math.min(95, Math.max(0, ((ev.clientX - r.left) / r.width) * 100));
        m.y = Math.min(96, Math.max(0, ((ev.clientY - r.top) / r.height) * 100));
        w.style.left = m.x + '%'; w.style.top = m.y + '%';
      };
      const up = () => { w.removeEventListener('pointermove', move); w.removeEventListener('pointerup', up); commit(); };
      w.addEventListener('pointermove', move);
      w.addEventListener('pointerup', up);
    });
    stage.append(w);
  };
  const redraw = () => { stage.querySelectorAll('.sil-word').forEach((n) => n.remove()); st.mots.forEach(place); };
  redraw();
  const f = el('form', { class: 'add-own' });
  const inp = el('input', { type: 'text', placeholder: 'Un mot ou une expression…', 'aria-label': 'Mot à placer' });
  f.append(inp, el('button', { class: 'btn ghost small', type: 'submit' }, 'Ajouter'));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!inp.value.trim()) return;
    st.mots.push({ texte: inp.value.trim(), x: 2 + (st.mots.length % 3) * 3, y: 4 + (st.mots.length % 10) * 8 });
    inp.value = ''; commit(); redraw();
  });
  wrap.append(f, stage, el('p', { class: 'hint' }, 'Faites glisser les mots sur la silhouette ou autour d’elle.'));
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
})();

import { marked } from './vendor/marked.esm.js';

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

// ---------------------------------------------------------------------------
// State (answers stay on the device)
// ---------------------------------------------------------------------------
let state = loadLocal();
let parcours = null;
const taches = {};
let fileHandle = null;
let autosaveTimer = null;

function freshState() {
  return { app: APP_ID, version: 1, answers: {}, inclurePrive: false, savedAt: null, changedAt: null };
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
  } catch (e) { /* storage unavailable */ }
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
  if (fileHandle) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveToHandle().catch(() => updateSaveStatus()), 1500);
  }
}

// ---------------------------------------------------------------------------
// Content loading
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

// ---------------------------------------------------------------------------
// Saving to / opening a file
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
    if (e.name !== 'AbortError') alert('L’enregistrement a échoué : ' + e.message);
  }
}
function applyFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { alert('Ce fichier n’est pas un fichier de parcours valide.'); return false; }
  if (data.app !== APP_ID || typeof data.answers !== 'object') { alert('Ce fichier ne correspond pas à ce parcours.'); return false; }
  const priv = privateIds();
  const kept = {};
  for (const id of priv) if (state.answers[id] !== undefined && data.answers[id] === undefined) kept[id] = state.answers[id];
  state.answers = { ...data.answers, ...kept };
  state.inclurePrive = !!data.inclurePrive;
  state.changedAt = data.savedAt || new Date().toISOString();
  markSaved();
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
  return `il y a ${Math.round(h / 24)} jour(s)`;
}
function updateSaveStatus() {
  const s = $('#save-status');
  const dirty = state.changedAt && (!state.savedAt || state.changedAt > state.savedAt);
  if (!state.savedAt && !state.changedAt) { s.textContent = ''; s.className = 'save-status'; return; }
  if (dirty) {
    s.textContent = fileHandle ? 'Enregistrement…' : 'Modifications non enregistrées';
    s.className = 'save-status warn';
  } else {
    s.textContent = `Enregistré ${relTime(state.savedAt)}` + (fileHandle ? ' · auto' : '');
    s.className = 'save-status ok';
  }
}
setInterval(updateSaveStatus, 60000);
window.addEventListener('beforeunload', (e) => {
  if (state.changedAt && (!state.savedAt || state.changedAt > state.savedAt)) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------------------------
// Lehrplan drawer
// ---------------------------------------------------------------------------
function openLP(url) {
  const d = $('#drawer');
  d.hidden = false;
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
// Sidebar
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
function renderSidebar() {
  const nav = $('#sidebar');
  nav.innerHTML = '';
  nav.append(el('a', { href: '#/', 'data-route': '' }, '<span class="num">◆</span><span class="lbl">Accueil</span>'));
  for (const id of parcours.taches) {
    const t = taches[id];
    nav.append(el('a', { href: `#/${id}`, 'data-route': id },
      `<span class="num">${esc(t.numero === 'finale' ? '★' : t.numero)}</span><span class="lbl">${esc(t.titre_court || t.titre)}<small>${esc(t.duree)}</small></span><span class="prog" data-prog="${id}"></span>`));
  }
  nav.append(el('a', { href: '#/dossier', 'data-route': 'dossier' }, '<span class="num">▤</span><span class="lbl">Dossier</span>'));
  renderSidebarProgress();
}
function renderSidebarProgress() {
  document.querySelectorAll('[data-prog]').forEach((n) => {
    const p = tacheProgress(n.dataset.prog);
    n.innerHTML = `<span style="width:${p}%"></span>`;
    n.title = `${p} % des réponses`;
  });
}
function markActive(r) {
  document.querySelectorAll('#sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
}
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
function renderHome(main) {
  const p = parcours;
  main.append(el('section', { class: 'hero' }, `
    <p class="eyebrow">${esc(p.sous_titre)} · ${esc(p.semestre)}</p>
    <h1>${esc(p.titre)}</h1>
    <div class="lead">${md(p.intro)}</div>`));
  main.append(el('section', { class: 'card' }, `<h2>Cadre de travail</h2>${md(p.cadre)}`));
  main.append(el('section', { class: 'card' }, `<h2>Objectifs du parcours</h2><ul>${p.objectifs.map((o) => `<li>${mdInline(o)}</li>`).join('')}</ul>`));
  const rows = p.taches.map((id) => {
    const t = taches[id];
    return `<tr><td><a href="#/${id}">${esc(t.numero === 'finale' ? 'Tâche finale' : 'Tâche ' + t.numero)} · ${esc(t.titre_court || t.titre)}</a></td><td>${esc(t.duree)}</td><td>${esc(t.resultat)}</td></tr>`;
  }).join('');
  main.append(el('section', { class: 'card' }, `<h2>Les étapes en un coup d’œil</h2>
    <table class="overview"><thead><tr><th>Tâche</th><th>Durée</th><th>Principales productions</th></tr></thead><tbody>${rows}</tbody></table>`));
  const sv = el('section', { class: 'card notice' }, `<h2>Vos réponses et l’enregistrement</h2>${md(p.sauvegarde)}`);
  main.append(sv);
  main.append(el('p', { class: 'next' }, `<a class="btn primary" href="#/${p.taches[0]}">Commencer la tâche 1 →</a>`));
}

function renderTache(main, id) {
  const t = taches[id];
  main.append(el('section', { class: 'hero' }, `
    <p class="eyebrow">${esc(t.numero === 'finale' ? 'Tâche finale' : 'Tâche ' + t.numero)}</p>
    <h1>${mdInline(t.titre)}</h1>
    <p class="meta"><span>⏱ ${esc(t.duree)}</span><span>👥 ${esc(t.modalite)}</span></p>
    <p class="meta result"><strong>Résultat :</strong> ${esc(t.resultat)}</p>`));
  for (const b of t.blocs) {
    const node = renderBlock(b);
    if (!node) continue;
    if (REDACTION) node.prepend(el('div', { class: 'redac-tag' }, `${esc(b.type)} · <code>${esc(b.id)}</code>${b.statut_contenu ? ` · <mark>${esc(b.statut_contenu)}</mark>` : ''}`));
    main.append(node);
  }
  const idx = parcours.taches.indexOf(id);
  const next = parcours.taches[idx + 1];
  const foot = el('section', { class: 'card notice end' }, `
    <h2>Fin de la tâche</h2>
    <p>Pensez à <strong>enregistrer</strong> votre progression avant de continuer.</p>`);
  const actions = el('div', { class: 'row' });
  actions.append(el('button', { class: 'btn primary', onclick: save }, 'Enregistrer maintenant'));
  if (next) actions.append(el('a', { class: 'btn ghost', href: `#/${next}` }, 'Tâche suivante →'));
  else actions.append(el('a', { class: 'btn ghost', href: '#/dossier' }, 'Voir le dossier →'));
  foot.append(actions);
  main.append(foot);
}

// ---------------------------------------------------------------------------
// Blocks
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
    case 'rappel': return blockRappel(b);
    case 'silhouette': return blockSilhouette(b);
    case 'carte': return blockCarte(b);
    default: return REDACTION ? el('div', { class: 'card' }, `Type inconnu : ${esc(b.type)}`) : null;
  }
}

function blockTexte(b) {
  if (b.repliable) {
    const d = el('details', { class: 'card text' });
    d.innerHTML = `<summary>${esc(b.titre)}</summary><div class="prose">${md(b.corps)}</div>`;
    return d;
  }
  return el('section', { class: 'card text' }, `${b.titre ? `<h3>${esc(b.titre)}</h3>` : ''}<div class="prose">${md(b.corps)}</div>`);
}

function blockConsigne(b) {
  const meta = [b.duree && `⏱ ${esc(b.duree)}`, b.modalite && `👥 ${esc(b.modalite)}`].filter(Boolean).join('<span class="dot">·</span>');
  return el('section', { class: 'consigne', id: b.id }, `
    <h2>${mdInline(b.titre)}</h2>
    ${meta ? `<p class="meta">${meta}</p>` : ''}
    <div class="prose">${md(b.corps)}</div>`);
}

function blockReponse(b) {
  const wrap = el('section', { class: 'answer' + (b.prive ? ' private' : '') });
  const label = el('label', { for: `f-${b.id}` }, `${mdInline(b.label)}${b.prive ? ' <span class="badge">privé</span>' : ''}`);
  wrap.append(label);
  const rows = b.longueur === 'court' ? 2 : b.longueur === 'moyen' ? 4 : 8;
  const ta = el('textarea', { id: `f-${b.id}`, rows, placeholder: b.aide || '' });
  ta.value = getA(b.id, '');
  const info = el('div', { class: 'answer-info' });
  const updInfo = () => {
    const n = countWords(ta.value);
    if (b.mots_cible) {
      const ok = n >= b.mots_cible * 0.8 && n <= b.mots_cible * 1.3;
      info.innerHTML = `<span class="${ok ? 'ok' : ''}">${n} / ~${b.mots_cible} mots</span>`;
    } else info.textContent = n ? `${n} mots` : '';
  };
  ta.addEventListener('input', () => { setA(b.id, ta.value); updInfo(); autoGrow(ta); });
  updInfo();
  wrap.append(ta, info);
  if (b.prive) wrap.append(el('p', { class: 'hint' }, 'Ce texte reste sur cet ordinateur. Il n’est ajouté au fichier de sauvegarde ou au dossier que si vous le choisissez dans le dossier.'));
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
  wrap.append(el('button', { class: 'btn ghost small', onclick: () => { const r = b.colonnes.map(() => ''); data.push(r); addRow(r, data.length - 1); persist(); } }, '+ Ajouter une ligne'));
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
    const cats = el('div', { class: 'tri-cats', style: `--n:${b.categories.length}` });
    const boxes = {};
    for (const c of b.categories) {
      const box = el('div', { class: 'tri-cat', 'data-cat': c.id }, `<h4>${esc(c.label)}</h4>`);
      boxes[c.id] = box;
      cats.append(box);
    }
    b.elements.forEach((item, i) => {
      const placed = st.placements[i];
      let cls = 'chip';
      let note = '';
      if (st.verifie && placed) {
        const ok = item.solution === 'les-deux' || item.solution === placed;
        cls += ok ? ' right' : ' wrong';
        if (item.solution === 'les-deux') cls += ' both';
        if (item.explication && (item.solution === 'les-deux' || !ok)) note = item.explication;
      }
      if (selected === i) cls += ' selected';
      const chip = el('button', { class: cls, draggable: 'true', type: 'button', title: note || '' }, esc(item.texte) + (note ? ` <span class="why">${esc(note)}</span>` : ''));
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (placed && selected !== null && selected !== i) { drop(placed, selected); return; }
        if (placed) { delete st.placements[i]; st.verifie = false; selected = null; commit(); draw(); return; }
        selected = selected === i ? null : i; draw();
      });
      chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
      (placed && boxes[placed] ? boxes[placed] : pool).append(chip);
    });
    for (const a of st.ajouts) {
      if (boxes[a.cat]) boxes[a.cat].append(el('span', { class: 'chip own' }, esc(a.texte)));
    }
    const drop = (catId, idx) => {
      if (catId) st.placements[idx] = catId; else delete st.placements[idx];
      st.verifie = false; selected = null; commit(); draw();
    };
    [pool, ...Object.values(boxes)].forEach((zone) => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => { e.preventDefault(); drop(zone.dataset.cat, Number(e.dataTransfer.getData('text/plain'))); });
      zone.addEventListener('click', () => { if (selected !== null) drop(zone.dataset.cat, selected); });
    });
    if (pool.children.length) wrap.append(pool);
    wrap.append(cats);

    const bar = el('div', { class: 'row' });
    const allPlaced = Object.keys(st.placements).length === b.elements.length;
    bar.append(el('button', { class: 'btn primary', disabled: !allPlaced, onclick: () => { st.verifie = true; commit(); draw(); } }, 'Vérifier'));
    bar.append(el('button', { class: 'btn ghost', onclick: () => { st.placements = {}; st.verifie = false; commit(); draw(); } }, 'Recommencer'));
    wrap.append(bar);
    if (st.verifie) {
      const right = b.elements.filter((it, i) => it.solution === 'les-deux' || it.solution === st.placements[i]).length;
      wrap.append(el('p', { class: 'feedback' }, `${right} / ${b.elements.length} placements correspondent à la proposition. En vert : conforme à la proposition. En rouge : à reconsidérer. En bleu : les deux catégories sont possibles — lisez la remarque sous l’élément.`));
    }
    if (b.ajout_libre) {
      const f = el('form', { class: 'row add-own' });
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

function blockAutocontrole(b) {
  const wrap = el('section', { class: 'check' });
  const st = getA(b.id, null) || { coches: [], vu: false };
  wrap.append(el('h3', {}, `✓ ${esc(b.titre)}`));
  const ul = el('ul');
  b.points.forEach((p, i) => {
    const li = el('li');
    const id = `c-${b.id}-${i}`;
    const cb = el('input', { type: 'checkbox', id });
    cb.checked = !!st.coches[i];
    cb.addEventListener('change', () => { st.coches[i] = cb.checked; setA(b.id, { ...st }); });
    li.append(cb, el('label', { for: id }, mdInline(p)));
    ul.append(li);
  });
  wrap.append(ul);
  if (b.exemple) {
    const box = el('div', { class: 'example-box prose', hidden: !st.vu }, `<h4>${esc(b.exemple_titre || 'Exemple')}</h4>${md(b.exemple)}<p class="hint">Un exemple parmi d’autres possibles — comparez, ne copiez pas.</p>`);
    const btn = el('button', { class: 'btn ghost small' }, st.vu ? 'Masquer l’exemple' : 'Comparer avec un exemple');
    btn.addEventListener('click', () => {
      st.vu = box.hidden; box.hidden = !box.hidden;
      btn.textContent = box.hidden ? 'Comparer avec un exemple' : 'Masquer l’exemple';
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
  return el('section', { class: 'card external' }, `<h3>↗ ${esc(b.titre)}</h3><div class="prose">${md(b.corps)}</div><div class="row">${links}</div>`);
}

function blockLehrplan(b) {
  const wrap = el('section', { class: 'card lp' }, `<h3>📘 ${esc(b.titre)}</h3>${b.corps ? `<div class="prose">${md(b.corps)}</div>` : ''}`);
  const row = el('div', { class: 'row' });
  for (const l of b.liens || []) {
    const url = l.recherche ? LP_SEARCH(l.recherche) : l.url;
    if (!url) continue;
    row.append(el('button', { class: 'btn ghost small', onclick: () => openLP(url) }, esc(l.label)));
  }
  wrap.append(row);
  return wrap;
}

function blockRappel(b) {
  const v = getA(b.source, '');
  return el('section', { class: 'card recall' }, `<h3>↺ ${esc(b.titre)}</h3>
    <blockquote>${v ? esc(v).replace(/\n/g, '<br>') : '<em>Aucune note pour l’instant.</em>'}</blockquote>
    ${b.corps ? `<div class="prose">${md(b.corps)}</div>` : ''}`);
}

const SILHOUETTE_SVG = `<svg viewBox="0 0 200 400" aria-hidden="true"><g fill="var(--sil)">
<circle cx="100" cy="48" r="32"/>
<path d="M60 92 Q100 82 140 92 L160 112 Q170 160 172 220 L156 222 L150 150 L146 236 Q146 300 138 388 L112 388 L104 262 L96 262 L88 388 L62 388 Q54 300 54 236 L50 150 L44 222 L28 220 Q30 160 40 112 Z"/></g></svg>`;

function blockSilhouette(b) {
  const wrap = el('section', { class: 'answer private' });
  wrap.append(el('label', {}, 'Ma silhouette <span class="badge">privé</span>'));
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
  const f = el('form', { class: 'row add-own' });
  const inp = el('input', { type: 'text', placeholder: 'Un mot ou une expression…', 'aria-label': 'Mot à placer' });
  f.append(inp, el('button', { class: 'btn ghost small', type: 'submit' }, 'Ajouter'));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!inp.value.trim()) return;
    st.mots.push({ texte: inp.value.trim(), x: 2 + (st.mots.length % 3) * 3, y: 4 + (st.mots.length % 10) * 8 });
    inp.value = ''; commit(); redraw();
  });
  wrap.append(f, stage, el('p', { class: 'hint' }, 'Faites glisser les mots sur la silhouette ou autour d’elle. Il n’existe pas de placement correct.'));
  return wrap;
}

function blockCarte(b) {
  const wrap = el('section', { class: 'card' });
  const render = () => {
    const parts = b.champs.map((id) => {
      const blk = allBlocks().find((x) => x.id === id);
      return `<div class="carte-field"><h4>${esc(blk ? blk.label : id)}</h4><p>${esc(getA(id, '') || '…').replace(/\n/g, '<br>')}</p></div>`;
    }).join('');
    return `<div class="carte"><div class="carte-head">${esc(b.titre)}</div>${parts}</div>`;
  };
  wrap.innerHTML = `<h3>Aperçu de la carte</h3>${render()}`;
  wrap.append(el('button', { class: 'btn primary small', onclick: () => printHTML(render(), 'print-carte') }, 'Imprimer la carte'));
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
    return `<section class="d-tache"><h2>${esc(t.numero === 'finale' ? 'Tâche finale' : 'Tâche ' + t.numero)} — ${mdInline(t.titre)}</h2>${items || '<p class="muted">Aucune réponse pour l’instant.</p>'}</section>`;
  }).join('');
}
function renderDossier(main) {
  main.append(el('section', { class: 'hero' }, `<p class="eyebrow">Dossier</p><h1>Mes réponses</h1>
    <p class="lead">Toutes vos réponses rassemblées. Imprimez-les ou enregistrez-les en PDF comme point de départ pour votre dossier final.</p>`));
  const opts = el('section', { class: 'card' });
  const lab = el('label', { class: 'toggle' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = state.inclurePrive;
  cb.addEventListener('change', () => { state.inclurePrive = cb.checked; persistLocal(); main.innerHTML = ''; renderDossier(main); });
  lab.append(cb, document.createTextNode(' Inclure mes textes privés (poème, carte « Moi », silhouette, exemple personnel) dans le dossier et dans le fichier de sauvegarde'));
  opts.append(lab);
  const row = el('div', { class: 'row' });
  row.append(el('button', { class: 'btn primary', onclick: () => printHTML(`<h1>${esc(parcours.titre)}</h1>${dossierHTML()}`, 'print-dossier') }, 'Imprimer / PDF'));
  opts.append(row);
  main.append(opts);
  main.append(el('div', { class: 'dossier card' }, dossierHTML()));
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
// Router
// ---------------------------------------------------------------------------
function route() {
  const main = $('#main');
  const r = location.hash.replace(/^#\/?/, '');
  main.innerHTML = '';
  document.body.classList.remove('nav-open');
  if (r === 'dossier') renderDossier(main);
  else if (taches[r]) renderTache(main, r);
  else renderHome(main);
  markActive(taches[r] || r === 'dossier' ? r : '');
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

$('#btn-save').addEventListener('click', save);
$('#btn-open').addEventListener('click', openFile);
window.addEventListener('hashchange', route);

(async () => {
  try {
    await loadContent();
  } catch (e) {
    $('#main').innerHTML = `<div class="card notice"><h2>Le contenu n’a pas pu être chargé.</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (REDACTION) document.body.classList.add('redaction');
  renderSidebar();
  updateSaveStatus();
  route();
})();

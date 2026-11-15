// Motifs «L’entre-deux» : formes organiques semi-transparentes qui se chevauchent.
// Là où elles se recouvrent naît une troisième couleur – l’espace entre les perspectives.
// Aucune figure humaine, aucun drapeau, aucun globe.

// Couleurs reprises du thème actif (variables CSS --m1 à --m4).
const C = {
  petrol: 'var(--m1)',
  terre: 'var(--m2)',
  ocre: 'var(--m3)',
  lilas: 'var(--m4)',
};

// Pseudo-aléatoire déterministe : même graine → même forme.
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Forme organique fermée autour de (cx, cy).
export function blob(cx, cy, r, seed, { points = 7, wobble = 0.16, sx = 1, sy = 1 } = {}) {
  const rand = rng(seed);
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (1 - wobble + rand() * wobble * 2);
    pts.push([cx + Math.cos(a) * rr * sx, cy + Math.sin(a) * rr * sy]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let d = `M${mid(pts[pts.length - 1], pts[0]).map((n) => n.toFixed(1)).join(' ')}`;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % pts.length]);
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return d + 'Z';
}

const shape = (d, color, op = 0.78) => `<path d="${d}" style="fill:${color};fill-opacity:${op};mix-blend-mode:multiply"/>`;

const MOTIFS = {
  accueil: () =>
    shape(blob(78, 62, 46, 11), C.petrol) +
    shape(blob(122, 66, 44, 23), C.terre, 0.72),
  t1: () => // arbre : feuillage visible, racines invisibles
    `<path d="M100 66 C 98 80, 102 92, 100 104" style="stroke:${C.petrol}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>` +
    shape(blob(100, 48, 40, 5, { sx: 1.25, sy: 0.85 }), C.petrol) +
    shape(blob(100, 108, 30, 9, { sx: 1.5, sy: 0.55, wobble: 0.25 }), C.terre, 0.7),
  t2: () => // plusieurs facettes, un seul « moi »
    shape(blob(80, 56, 32, 3), C.petrol) +
    shape(blob(120, 56, 32, 8), C.terre, 0.72) +
    shape(blob(100, 88, 32, 17), C.ocre, 0.8),
  t3: () => // la tête, le cœur, la main
    shape(blob(58, 66, 30, 4), C.petrol) +
    shape(blob(100, 66, 30, 12), C.terre, 0.72) +
    shape(blob(142, 66, 30, 21), C.ocre, 0.8),
  t4: () => // une carte, un grain de sable
    `<g transform="rotate(-8 100 66)"><rect x="56" y="30" width="78" height="74" rx="10" style="fill:${C.ocre};fill-opacity:.8;mix-blend-mode:multiply"/></g>` +
    shape(blob(124, 72, 34, 31), C.petrol, 0.75) +
    `<circle cx="86" cy="94" r="8" style="fill:${C.terre};fill-opacity:.85"/>`,
  dossier: () =>
    `<rect x="58" y="34" width="70" height="80" rx="8" style="fill:${C.petrol};fill-opacity:.75;mix-blend-mode:multiply"/>` +
    `<rect x="74" y="24" width="70" height="80" rx="8" style="fill:${C.terre};fill-opacity:.6;mix-blend-mode:multiply"/>`,
  prive: () =>
    shape(blob(100, 66, 40, 41), C.lilas, 0.6),
};

export function motif(kind, cls = '') {
  const draw = MOTIFS[kind] || MOTIFS.accueil;
  return `<svg class="motif ${cls}" viewBox="0 0 200 132" aria-hidden="true" focusable="false">${draw()}</svg>`;
}

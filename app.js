/* Gym Log — app */
'use strict';

/* ---------- Stato ---------- */
const S = {
  ex: new Map(),
  plans: [],
  workouts: [],
  lastBackup: null,
  route: { name: 'home', id: null },
  draft: null,
  picker: null,
  sheet: null,
  homeDay: null,
  histLimit: 20,
  range: '3M',
  massFilter: 'Tutti',
  justFinished: null,
  safetyFound: null,
  pendingImport: null
};

const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

/* ---------- Utilità ---------- */
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DOW = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const DOW_LONG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const DOW_LETTER = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const DAY_MS = 86400000;
const KG_STEP = 2.5;

function uid(p) {
  const r = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return p + '-' + r;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function pad(n) { return String(n).padStart(2, '0'); }
function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayISO() { return isoOf(new Date()); }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
function weekKey(iso) { return isoOf(mondayOf(parseISO(iso))); }
function weeksBetween(aIso, bIso) { return Math.round((mondayOf(parseISO(bIso)) - mondayOf(parseISO(aIso))) / (7 * DAY_MS)); }
function dateShort(iso) { const d = parseISO(iso); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function dateLong(iso) { const d = parseISO(iso); const w = DOW_LONG[d.getDay()]; return w.charAt(0).toUpperCase() + w.slice(1) + ' ' + d.getDate() + ' ' + MONTHS_LONG[d.getMonth()]; }
function weekRangeLabel(monIso) {
  const a = parseISO(monIso); const b = addDays(a, 6);
  if (a.getMonth() === b.getMonth()) return a.getDate() + '–' + b.getDate() + ' ' + MONTHS[a.getMonth()];
  return a.getDate() + ' ' + MONTHS[a.getMonth()] + '–' + b.getDate() + ' ' + MONTHS[b.getMonth()];
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  const r = Math.round(n * 100) / 100;
  return String(r).replace('.', ',');
}
function fmtKg(kg, bw) {
  if (bw) return kg > 0 ? 'CL+' + fmtNum(kg) : 'CL';
  return kg == null ? '—' : fmtNum(kg);
}
function fmtKgUnit(kg, bw) { return bw ? fmtKg(kg, true) : (kg == null ? '—' : fmtNum(kg) + ' kg'); }
function parseNum(s) {
  const v = parseFloat(String(s).replace(',', '.'));
  return isNaN(v) ? null : v;
}
function e1rm(kg, reps) { if (kg == null || !reps) return 0; return reps <= 1 ? kg : kg * (1 + reps / 30); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

/* ---------- Dati ---------- */
const exOf = (id) => S.ex.get(id) || { id, name: 'Esercizio eliminato', group: '', bw: false, fixedNote: '' };
const activePlan = () => S.plans.find((p) => !p.endedOn) || null;
const getWorkout = (id) => S.workouts.find((w) => w.id === id) || null;
const inProgress = () => S.workouts.find((w) => !w.endedAt) || null;
const wKey = (w) => w.date + '|' + String(w.startedAt || 0).padStart(15, '0');
function finished() {
  return S.workouts.filter((w) => w.endedAt).sort((a, b) => (wKey(a) < wKey(b) ? 1 : -1));
}
const doneSets = (item) => item.sets.filter((s) => s.done);

function setScore(ex, s) {
  if (ex.bw) return (s.kg || 0) * 1000 + (s.reps || 0);
  if (s.kg == null) return null;
  return e1rm(s.kg, s.reps);
}
/* Ultima sessione di un esercizio prima dell'allenamento indicato */
function lastSessionFor(exId, before) {
  const lim = before ? wKey(before) : null;
  for (const w of finished()) {
    if (lim && wKey(w) >= lim) continue;
    if (before && w.id === before.id) continue;
    const item = w.items.find((it) => it.exId === exId && doneSets(it).length);
    if (item) return { w, item, sets: doneSets(item) };
  }
  return null;
}
function bestBefore(exId, before) {
  const ex = exOf(exId); const lim = before ? wKey(before) : null;
  let best = null;
  for (const w of finished()) {
    if (lim && wKey(w) >= lim) continue;
    if (before && w.id === before.id) continue;
    for (const it of w.items) {
      if (it.exId !== exId) continue;
      for (const s of doneSets(it)) {
        const sc = setScore(ex, s);
        if (sc != null && (best == null || sc > best)) best = sc;
      }
    }
  }
  return best;
}
function describeSets(ex, sets) {
  if (!sets.length) return '—';
  const same = sets.every((s) => s.kg === sets[0].kg);
  if (same) return fmtKgUnit(sets[0].kg, ex.bw) + ' × ' + sets.map((s) => s.reps).join(' · ');
  return sets.map((s) => fmtKg(s.kg, ex.bw) + '×' + s.reps).join(' · ');
}
function planWeekNo(plan, iso) { return weeksBetween(plan.startDate, iso || todayISO()) + 1; }
function lastPlanWorkout(plan) { return finished().find((w) => w.planId === plan.id) || null; }
function nextDay(plan) {
  const last = lastPlanWorkout(plan);
  if (!last) return plan.days[0];
  const i = plan.days.findIndex((d) => d.id === last.dayId);
  return plan.days[(i + 1) % plan.days.length] || plan.days[0];
}
function targetFor(planId, exId) {
  const p = S.plans.find((x) => x.id === planId); if (!p) return null;
  for (const d of p.days) { const it = d.items.find((i) => i.exId === exId); if (it) return it; }
  return null;
}

/* ---------- Salvataggio ---------- */
let savedTimer = null;
async function saveWorkout(w) {
  try { await DB.put('workouts', w); flashSaved(); }
  catch (e) { toast('Errore nel salvataggio. Riprova.'); }
}
function flashSaved() {
  const el = document.getElementById('savedFlag');
  if (!el) return;
  el.classList.add('pulse');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('pulse'), 600);
}
async function savePlan(p) { await DB.put('plans', p); }

function exportData() {
  return { app: 'gymlog', version: 1, exportedAt: new Date().toISOString(), exercises: [...S.ex.values()], plans: S.plans, workouts: S.workouts };
}
function summaryData() {
  const d = exportData();
  d.summary = true;
  d.exercises = d.exercises.filter((e) => !e.builtin);
  d.workouts = d.workouts.filter((w) => w.endedAt).map((w) => ({
    ...w,
    items: w.items.map((it) => {
      const ex = exOf(it.exId); const ds = doneSets(it);
      const best = ds.reduce((a, s) => (a == null || (setScore(ex, s) || 0) > (setScore(ex, a) || 0) ? s : a), null);
      return { exId: it.exId, note: it.note, sets: best ? [best] : [] };
    })
  }));
  return d;
}
/* Copia di riserva interna: completa se c'è spazio, altrimenti il riassunto. */
function safetyCopy() {
  try { localStorage.setItem('gymlog-safety', JSON.stringify(exportData())); return; } catch (e) { /* troppo grande */ }
  try { localStorage.setItem('gymlog-safety', JSON.stringify(summaryData())); } catch (e) { /* niente spazio */ }
}

async function loadAll() {
  let exs = await DB.all('exercises');
  const have = new Set(exs.map((e) => e.id));
  const missing = defaultExerciseRecords().filter((e) => !have.has(e.id));
  if (missing.length) { await DB.putMany('exercises', missing); exs = exs.concat(missing); }
  S.ex = new Map(exs.map((e) => [e.id, e]));
  S.plans = await DB.all('plans');
  S.workouts = await DB.all('workouts');
  S.lastBackup = (await DB.getMeta('lastBackup')) || null;
}

/* ---------- Toast con Annulla ---------- */
let toastTimer = null;
let toastUndo = null;
function toast(msg, undo) {
  toastUndo = undo || null;
  $toast.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" data-a="undo">Annulla</button>' : '');
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 5000 : 2600);
}
function hideToast() { $toast.classList.remove('show'); toastUndo = null; }

/* ---------- Routing ---------- */
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'home', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}
function go(hash) { if (location.hash === hash) { render(); } else { location.hash = hash; } }
window.addEventListener('hashchange', () => {
  S.route = parseRoute();
  S.sheet = S.afterNav || null; S.afterNav = null; S.picker = null;
  render(true);
});

/* ---------- Icone ---------- */
const I = {
  back: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  chev: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  arrow: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  plus: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  minus: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  up: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  info: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>',
  trophy: '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M12 13v4M9 20h6M10 17h4"/></svg>',
  tabHome: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  tabTrain: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
  tabDots: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="8" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="6" cy="16" r="2"/><circle cx="12" cy="16" r="2"/></svg>',
  tabTrophy: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M12 13v4M9 20h6M10 17h4"/></svg>'
};

function tabbar(active) {
  const t = (key, href, icon, label) =>
    '<a href="' + href + '" class="tab' + (active === key ? ' on' : '') + '"' + (active === key ? ' aria-current="page"' : '') + '>' + icon + '<span>' + label + '</span></a>';
  return '<nav class="tabbar" aria-label="Sezioni">' +
    t('home', '#/', I.tabHome, 'Storico') +
    t('allena', '#/allena', I.tabTrain, 'Allena') +
    t('costanza', '#/costanza', I.tabDots, 'Costanza') +
    t('massimali', '#/massimali', I.tabTrophy, 'Massimali') +
    '</nav>';
}
function topbar(backHref, small, title, right) {
  return '<header class="topbar">' +
    '<a class="iconbtn" href="' + backHref + '" aria-label="Indietro">' + I.back + '</a>' +
    '<div class="tb-title">' + (small ? '<div class="small">' + esc(small) + '</div>' : '') + '<div class="t">' + esc(title) + '</div></div>' +
    (right || '') + '</header>';
}
function stepper(action, value, label, extra) {
  return '<div class="stepper">' +
    '<button type="button" class="st-btn" data-a="' + action + '" data-d="-1"' + (extra || '') + ' aria-label="Diminuisci ' + label + '">−</button>' +
    '<div class="st-val">' + value + '</div>' +
    '<button type="button" class="st-btn plus" data-a="' + action + '" data-d="1"' + (extra || '') + ' aria-label="Aumenta ' + label + '">+</button></div>';
}

/* ---------- Render ---------- */
function render(routeChanged) {
  const y = window.scrollY;
  const r = S.route;
  let html; let tab = 'home';
  switch (r.name) {
    case 'allena': html = screenAllena(); tab = 'allena'; break;
    case 'allenamento': html = screenWorkout(); tab = 'allena'; break;
    case 'modifica': html = screenEditWorkout(); tab = 'allena'; break;
    case 'riepilogo': html = screenSummary(); break;
    case 'scheda': html = screenPlan(); break;
    case 'nuova': html = screenDraft(); break;
    case 'costanza': html = screenStreak(); tab = 'costanza'; break;
    case 'massimali': html = screenRecords(); tab = 'massimali'; break;
    case 'esercizio': html = screenExercise(); tab = 'massimali'; break;
    default: html = screenHome();
  }
  if (html == null) return; /* la schermata ha già reindirizzato */
  $app.innerHTML = html + tabbar(tab);
  window.scrollTo(0, routeChanged ? 0 : y);
  renderOverlay();
  renderSheet();
  updateWakeLock();
}

/* ---------- Home ---------- */
function screenHome() {
  const today = todayISO();
  const fin = finished();
  const trained = new Set(fin.map((w) => w.date));
  const mon = mondayOf(new Date());
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i); const iso = isoOf(d);
    const cls = iso === today ? ' today' : (trained.has(iso) ? ' trained' : (iso > today ? ' future' : ''));
    strip += '<div class="day' + cls + '"><span class="l">' + DOW_LETTER[i] + '</span><span class="n">' + d.getDate() + '</span><span class="dot' + (trained.has(iso) ? ' on' : '') + '"></span></div>';
  }

  let html = '<main class="screen"><header class="hero"><div class="small">' + dateLong(today) + '</div><h1>Gym Log</h1></header>';

  if (S.safetyFound) {
    html += '<div class="card warn"><div class="card-t">Copia di sicurezza trovata</div><p class="muted">Del ' + esc(new Date(S.safetyFound.exportedAt).toLocaleDateString('it-IT')) + ', con ' + plural(S.safetyFound.workouts.length, 'allenamento', 'allenamenti') + '. Vuoi ripristinarla?</p><div class="row2"><button type="button" class="btn primary" data-a="restoreSafety">Ripristina</button><button type="button" class="btn ghost" data-a="dismissSafety">No</button></div></div>';
  }

  html += '<div class="strip">' + strip + '</div>';

  const cur = inProgress();
  const plan = activePlan();
  if (cur) {
    const all = cur.items.reduce((a, it) => a + it.sets.length, 0);
    const done = cur.items.reduce((a, it) => a + doneSets(it).length, 0);
    const t = new Date(cur.startedAt);
    html += '<div class="card live"><div class="live-tag"><span></span>Allenamento in corso</div>' +
      '<div class="card-t big">' + esc(cur.dayName) + '</div>' +
      '<div class="muted">' + done + ' di ' + all + ' serie · iniziato alle ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + '</div>' +
      '<div class="bar"><div style="width:' + (all ? Math.round(done / all * 100) : 0) + '%"></div></div>' +
      '<div class="row2"><a class="btn primary grow2" href="#/allenamento/' + cur.id + '">Riprendi</a><button type="button" class="btn ghost" data-a="finish" data-w="' + cur.id + '">Termina</button></div></div>';
  } else if (plan) {
    const nxt = nextDay(plan);
    const chosen = plan.days.find((d) => d.id === S.homeDay) || nxt;
    const last = lastPlanWorkout(plan);
    html += '<button type="button" class="cta" data-a="start" data-day="' + chosen.id + '"><span><span class="cta-t">Inizia allenamento</span><span class="cta-s">' + esc(chosen.name) + (chosen.id === nxt.id ? ' · prossimo' : '') + '</span></span>' + I.arrow + '</button>';
    html += '<p class="hint">' + (last ? 'Prossimo nella scheda, dopo ' + esc(last.dayName) + ' di ' + DOW_LONG[parseISO(last.date).getDay()] + '.' : 'Primo allenamento di questa scheda.') + ' Oppure scegli:</p>';
    html += '<div class="chips fill">' + plan.days.map((d) => '<button type="button" class="chip' + (d.id === chosen.id ? ' on' : '') + '" aria-pressed="' + (d.id === chosen.id) + '" data-a="homeDay" data-day="' + d.id + '">' + esc(d.name) + '</button>').join('') + '</div>';
  }

  if (plan) {
    const wk = planWeekNo(plan);
    html += '<a class="card link" href="#/scheda"><div class="between"><div><div class="label">Scheda attiva</div><div class="card-t">' + esc(plan.name) + '</div></div>' + I.chev + '</div>' +
      '<div class="muted">' + weekText(plan, wk) + ' · ' + plural(plan.daysPerWeek, 'giorno', 'giorni') + ' a settimana</div>' +
      '<div class="bar"><div style="width:' + Math.min(100, Math.round(wk / plan.weeks * 100)) + '%"></div></div></a>';
  } else {
    html += '<div class="card"><div class="card-t">Nessuna scheda attiva</div><p class="muted">Crea la tua scheda: giorni, esercizi e per quante settimane la segui.</p><button type="button" class="btn primary" data-a="newPlan">Crea scheda</button></div>';
  }

  const now = new Date();
  const monthCount = fin.filter((w) => { const d = parseISO(w.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
  html += '<div class="sec-h"><h2>Storico</h2><span class="muted">' + MONTHS_LONG[now.getMonth()].replace(/^./, (c) => c.toUpperCase()) + ' · ' + plural(monthCount, 'allenamento', 'allenamenti') + '</span></div>';
  if (!fin.length) {
    html += '<p class="empty">Ancora nessun allenamento. Il primo comparirà qui.</p>';
  } else {
    html += '<div class="list">' + fin.slice(0, S.histLimit).map(historyRow).join('') + '</div>';
    if (fin.length > S.histLimit) html += '<button type="button" class="btn ghost full" data-a="more">Mostra altri</button>';
  }

  html += backupCard();
  html += '</main>';
  return html;
}
function weekText(plan, wk) {
  return wk > plan.weeks ? 'Settimana ' + wk + ' (previste ' + plan.weeks + ')' : 'Settimana ' + wk + ' di ' + plan.weeks;
}
function historyRow(w) {
  const d = parseISO(w.date);
  const sets = w.items.reduce((a, it) => a + doneSets(it).length, 0);
  return '<a class="hrow" href="#/riepilogo/' + w.id + '"><div class="datebox"><span class="dw">' + DOW[d.getDay()] + '</span><span class="dn">' + d.getDate() + '</span></div>' +
    '<div class="grow"><div class="rt">' + esc(w.dayName) + '</div><div class="muted sm">' + plural(w.items.length, 'esercizio', 'esercizi') + ' · ' + sets + ' serie</div></div>' + I.chev + '</a>';
}
function backupAgeDays() { return S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / DAY_MS) : null; }
function backupCard() {
  const age = backupAgeDays();
  const txt = age == null ? 'Mai fatto' : age === 0 ? 'Oggi' : age === 1 ? 'Ieri' : age + ' giorni fa';
  const late = age == null ? S.workouts.length > 0 : age > 14;
  return '<div class="card' + (late ? ' warn' : '') + '"><div class="card-t">Backup dei dati</div>' +
    '<p class="muted">Ultimo backup: <strong>' + txt + '</strong>. I dati restano sul telefono: salva il file su Drive, iCloud o in una chat con te stesso.</p>' +
    '<div class="row2"><button type="button" class="btn outline" data-a="export">Esporta</button><button type="button" class="btn ghost" data-a="import">Importa</button></div>' +
    '<button type="button" class="linkbtn" data-a="exportCsv">Esporta come CSV per Excel</button></div>';
}

/* ---------- Allena ---------- */
function screenAllena() {
  const cur = inProgress();
  if (cur) { location.replace('#/allenamento/' + cur.id); return null; }
  const plan = activePlan();
  let html = '<main class="screen"><header class="hero"><div class="small">' + dateLong(todayISO()) + '</div><h1>Allena</h1></header>';
  if (!plan) {
    html += '<div class="card"><div class="card-t">Prima crea una scheda</div><p class="muted">Gli allenamenti partono dai giorni della tua scheda.</p><button type="button" class="btn primary" data-a="newPlan">Crea scheda</button></div></main>';
    return html;
  }
  const nxt = nextDay(plan);
  const order = [nxt].concat(plan.days.filter((d) => d.id !== nxt.id));
  html += '<p class="hint">' + esc(plan.name) + ' · ' + weekText(plan, planWeekNo(plan)) + '</p><div class="list">';
  html += order.map((d) => '<button type="button" class="dayrow' + (d.id === nxt.id ? ' next' : '') + '" data-a="start" data-day="' + d.id + '">' +
    '<div class="grow"><div class="rt">' + esc(d.name) + (d.id === nxt.id ? ' <span class="badge">Prossimo</span>' : '') + '</div>' +
    '<div class="muted sm">' + esc(d.items.map((i) => exOf(i.exId).name).join(', ')) + '</div></div>' + I.arrow + '</button>').join('');
  html += '</div></main>';
  return html;
}

function buildItem(exId, nSets, reps, before) {
  const ex = exOf(exId);
  const last = lastSessionFor(exId, before);
  const n = nSets || (last ? last.sets.length : 3);
  const sets = [];
  for (let i = 0; i < n; i++) {
    const src = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null;
    sets.push({ kg: src ? src.kg : (ex.bw ? 0 : null), reps: src ? src.reps : (reps || 10), done: false });
  }
  return { exId, note: '', sets };
}

async function startWorkout(dayId) {
  const cur = inProgress();
  if (cur) { go('#/allenamento/' + cur.id); return; }
  const plan = activePlan(); if (!plan) return;
  const day = plan.days.find((d) => d.id === dayId) || nextDay(plan);
  const w = { id: uid('w'), date: todayISO(), startedAt: Date.now(), endedAt: null, planId: plan.id, dayId: day.id, dayName: day.name, items: [] };
  w.items = day.items.map((it) => buildItem(it.exId, it.sets, it.reps, w));
  S.workouts.push(w);
  S.homeDay = null;
  await saveWorkout(w);
  go('#/allenamento/' + w.id);
}

/* ---------- Allenamento ---------- */
function screenWorkout() {
  const w = getWorkout(S.route.id);
  if (!w) { location.replace('#/'); return null; }
  const editingPast = !!w.endedAt;
  const all = w.items.reduce((a, it) => a + it.sets.length, 0);
  const done = w.items.reduce((a, it) => a + doneSets(it).length, 0);
  let html = '<main class="screen workout"><div class="sticky">' +
    topbar(editingPast ? '#/riepilogo/' + w.id : '#/', dateShort(w.date) + (editingPast ? ' · modifica' : ''), w.dayName,
      '<a class="btn small ghost" href="#/modifica/' + w.id + '">Modifica</a>') +
    '<div class="prog"><div class="bar"><div style="width:' + (all ? Math.round(done / all * 100) : 0) + '%"></div></div><span class="muted sm">' + done + ' / ' + all + ' serie</span></div>' +
    '<div class="saved" id="savedFlag">' + I.check + ' Salvato a ogni tocco · valori dall\'ultima volta</div></div>';

  if (!w.items.length) html += '<p class="empty">Nessun esercizio. Tocca Modifica per aggiungerne.</p>';

  w.items.forEach((it, i) => {
    const ex = exOf(it.exId);
    const last = lastSessionFor(it.exId, w);
    const best = bestBefore(it.exId, w);
    const target = targetFor(w.planId, it.exId);
    let suggest = '';
    if (last && target && last.sets.length && last.sets.every((s) => s.kg === last.sets[0].kg && s.reps >= target.reps) && (ex.bw || last.sets[0].kg != null)) {
      suggest = '<div class="pill">' + I.up + ' Puoi salire a ' + fmtKgUnit((last.sets[0].kg || 0) + KG_STEP, ex.bw) + '</div>';
    }
    html += '<section class="excard"><h2>' + esc(ex.name) + '</h2>' +
      '<div class="muted sm">' + (last ? 'Ultima volta · ' + esc(describeSets(ex, last.sets)) : 'Prima volta con questo esercizio') + '</div>' +
      (ex.fixedNote ? '<div class="fixednote">' + esc(ex.fixedNote) + '</div>' : '') + suggest +
      '<div class="sgrid head"><span>Set</span><span>Prima</span><span class="c">' + (ex.bw ? 'Kg' : 'Kg') + '</span><span class="c">Rip</span><span></span></div>';
    it.sets.forEach((s, j) => {
      const prev = last && last.sets[j] ? fmtKg(last.sets[j].kg, ex.bw) + ' × ' + last.sets[j].reps : '—';
      const sc = setScore(ex, s);
      const pr = s.done && best != null && sc != null && sc > best;
      html += '<div class="sgrid"><span class="n">' + (j + 1) + '</span><span class="ghost">' + esc(prev) + (pr ? ' <span class="pr">PR</span>' : '') + '</span>' +
        '<button type="button" class="val" data-a="editSet" data-i="' + i + '" data-j="' + j + '" aria-label="Peso serie ' + (j + 1) + '">' + fmtKg(s.kg, ex.bw) + '</button>' +
        '<button type="button" class="val" data-a="editSet" data-i="' + i + '" data-j="' + j + '" aria-label="Ripetizioni serie ' + (j + 1) + '">' + (s.reps == null ? '—' : s.reps) + '</button>' +
        '<button type="button" class="tick' + (s.done ? ' on' : '') + '" data-a="toggleSet" data-i="' + i + '" data-j="' + j + '" aria-pressed="' + s.done + '" aria-label="Serie ' + (j + 1) + (s.done ? ' fatta' : ' da fare') + '">' + (s.done ? I.check : '') + '</button></div>';
    });
    html += '<div class="exfoot"><button type="button" class="linkbtn acc" data-a="addSet" data-i="' + i + '">' + I.plus + ' Serie</button>' +
      '<button type="button" class="notebtn" data-a="noteSheet" data-i="' + i + '">' + (it.note ? 'Nota: ' + esc(it.note) : 'Aggiungi nota') + '</button></div></section>';
  });

  if (editingPast) {
    html += '<a class="btn primary full big" href="#/riepilogo/' + w.id + '">Fatto</a>';
  } else {
    html += '<button type="button" class="btn primary full big" data-a="finish" data-w="' + w.id + '">Termina allenamento</button>' +
      '<button type="button" class="linkbtn danger center" data-a="discardWorkout" data-w="' + w.id + '">Elimina questo allenamento</button>';
  }
  html += '</main>';
  return html;
}

/* ---------- Modifica allenamento ---------- */
function screenEditWorkout() {
  const w = getWorkout(S.route.id);
  if (!w) { location.replace('#/'); return null; }
  let html = '<main class="screen">' + topbar('#/allenamento/' + w.id, w.dayName + ' · ' + dateShort(w.date), 'Modifica allenamento') +
    '<div class="infobox">' + I.info + '<span>Le modifiche valgono solo per questo allenamento. La scheda resta uguale.</span></div><div class="list">';
  w.items.forEach((it, i) => {
    const ex = exOf(it.exId);
    html += '<div class="erow"><div class="grow"><div class="rt">' + esc(ex.name) + '</div><div class="muted sm">' + plural(it.sets.length, 'serie', 'serie') + (ex.bw ? ' · corpo libero' : '') + '</div></div>' +
      '<button type="button" class="btn small ghost" data-a="moveItem" data-i="' + i + '" data-d="-1" aria-label="Sposta su"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button type="button" class="btn small ghost" data-a="swapItem" data-i="' + i + '">Cambia</button>' +
      '<button type="button" class="iconbtn danger" data-a="removeItem" data-i="' + i + '" aria-label="Togli ' + esc(ex.name) + '">' + I.minus + '</button></div>';
  });
  html += '</div><button type="button" class="btn dashed full" data-a="addItems">' + I.plus + ' Aggiungi esercizio</button>' +
    '<a class="btn primary full big" href="#/allenamento/' + w.id + '">Fatto</a></main>';
  return html;
}

/* ---------- Riepilogo ---------- */
function workoutStats(w) {
  let sets = 0; let vol = 0; let prs = 0;
  const rows = w.items.map((it) => {
    const ex = exOf(it.exId); const ds = doneSets(it);
    sets += ds.length;
    ds.forEach((s) => { if (!ex.bw && s.kg != null) vol += s.kg * s.reps; });
    const best = bestBefore(it.exId, w);
    const pr = best != null && ds.some((s) => { const sc = setScore(ex, s); return sc != null && sc > best; });
    if (pr) prs++;
    const kgs = ds.map((s) => s.kg).filter((k) => k != null);
    const lo = Math.min.apply(null, kgs); const hi = Math.max.apply(null, kgs);
    const kg = !kgs.length ? (ex.bw ? 'CL' : '—') : lo === hi ? fmtKg(lo, ex.bw) : fmtKg(lo, ex.bw) + '–' + fmtNum(hi);
    return { ex, it, ds, pr, kg };
  });
  return { sets, vol, prs, rows };
}
function screenSummary() {
  const w = getWorkout(S.route.id);
  if (!w) { location.replace('#/'); return null; }
  if (!w.endedAt) { location.replace('#/allenamento/' + w.id); return null; }
  const st = workoutStats(w);
  const mins = w.startedAt && w.endedAt ? Math.max(1, Math.round((w.endedAt - w.startedAt) / 60000)) : null;
  let html = '<main class="screen">' + topbar('#/', dateLong(w.date), 'Riepilogo · ' + w.dayName) +
    '<div class="tiles2">' +
    tile('Durata', mins == null ? '—' : mins, mins == null ? '' : ' min') +
    tile('Serie', st.sets, '') +
    tile('Volume', Math.round(st.vol).toLocaleString('it-IT'), ' kg') +
    tile('Nuovi PR', st.prs, '', st.prs > 0) + '</div>';

  if (S.justFinished === w.id && (backupAgeDays() == null || backupAgeDays() >= 7)) {
    html += '<div class="card warn"><div class="card-t">Backup della settimana</div><p class="muted">Un tocco e il file va dove vuoi: Drive, iCloud o una chat con te stesso.</p><button type="button" class="btn primary" data-a="export">Salva backup</button></div>';
  }

  html += '<div class="ttable"><div class="trow th"><span>Esercizio · note</span><span class="c">Serie</span><span class="c">Rip</span><span class="c">Kg</span></div>';
  st.rows.forEach((r) => {
    html += '<div class="trow"><div><div class="rt sm2">' + esc(r.ex.name) + (r.pr ? ' <span class="pr">PR</span>' : '') + '</div>' + (r.it.note ? '<div class="muted xs">' + esc(r.it.note) + '</div>' : '') + '</div>' +
      '<span class="c b">' + r.ds.length + '</span><span class="c">' + r.ds.map((s) => s.reps).join(' · ') + '</span><span class="c b">' + esc(r.kg) + '</span></div>';
  });
  html += '</div><a class="btn primary full big" href="#/">Fatto</a>' +
    '<div class="row2"><a class="btn ghost" href="#/allenamento/' + w.id + '">Modifica</a><button type="button" class="btn ghost danger" data-a="deleteWorkout" data-w="' + w.id + '">Elimina</button></div></main>';
  return html;
}
function tile(label, value, unit, accent) {
  return '<div class="tile' + (accent ? ' acc' : '') + '"><div class="label">' + label + '</div><div class="tv">' + value + '<small>' + unit + '</small></div></div>';
}

/* ---------- Scheda ---------- */
function screenPlan() {
  const plan = activePlan();
  let html = '<main class="screen">' + topbar('#/', '', 'Scheda attiva');
  if (!plan) {
    return html + '<div class="card"><div class="card-t">Nessuna scheda attiva</div><button type="button" class="btn primary" data-a="newPlan">Crea scheda</button></div></main>';
  }
  const wk = planWeekNo(plan);
  html += '<div class="card"><div class="card-t big">' + esc(plan.name) + '</div>' +
    '<div class="muted">' + weekText(plan, wk) + ' · ' + plural(plan.daysPerWeek, 'giorno', 'giorni') + ' a settimana · dal ' + dateShort(plan.startDate) + '</div>' +
    '<div class="bar"><div style="width:' + Math.min(100, Math.round(wk / plan.weeks * 100)) + '%"></div></div>' +
    '<div class="between divider"><div><div class="rt">Durata</div><div class="muted xs">Puoi prolungarla quando vuoi</div></div>' + stepper('planWeeks', plan.weeks + ' sett.', 'settimane') + '</div></div>';
  html += '<div class="sec-h"><h2>Giorni</h2></div><div class="list">';
  html += plan.days.map((d) => '<div class="dcard"><div class="rt">' + esc(d.name) + '</div><div class="muted sm">' +
    d.items.map((i) => esc(exOf(i.exId).name) + ' <span class="dim">' + i.sets + '×' + i.reps + '</span>').join(', ') + '</div></div>').join('');
  html += '</div><button type="button" class="btn ghost full" data-a="editPlan">Modifica esercizi della scheda</button>' +
    '<button type="button" class="btn dashed full" data-a="newPlan">' + I.plus + ' Nuova scheda</button></main>';
  return html;
}

/* ---------- Nuova / modifica scheda ---------- */
function blankDraft() {
  return { editId: null, name: '', weeks: 8, daysPerWeek: 3, allDays: [1, 2, 3, 4, 5, 6].map(() => ({ id: uid('d'), name: '', items: [] })) };
}
function screenDraft() {
  if (!S.draft) S.draft = blankDraft();
  const d = S.draft; const edit = !!d.editId;
  let html = '<main class="screen">' + topbar(edit ? '#/scheda' : '#/', '', edit ? 'Modifica scheda' : 'Nuova scheda') +
    '<label class="flabel" for="planName">Nome</label><input id="planName" class="field" data-in="draftName" placeholder="Es. Push Pull Gambe" value="' + esc(d.name) + '" autocomplete="off">' +
    '<div class="card flat between"><div class="rt">Durata</div>' + stepper('draftWeeks', d.weeks + ' sett.', 'settimane') + '</div>' +
    '<div class="flabel">Giorni a settimana</div>';
  if (edit) {
    html += '<p class="muted sm">' + plural(d.daysPerWeek, 'giorno', 'giorni') + '. Per cambiarli crea una nuova scheda, così le settimane passate restano come erano.</p>';
  } else {
    html += '<div class="chips fill">' + [2, 3, 4, 5, 6].map((n) => '<button type="button" class="chip big' + (n === d.daysPerWeek ? ' on' : '') + '" aria-pressed="' + (n === d.daysPerWeek) + '" data-a="draftDays" data-n="' + n + '">' + n + '</button>').join('') + '</div>';
  }
  html += '<div class="sec-h"><h2>Giorni</h2></div><div class="list">';
  d.allDays.slice(0, d.daysPerWeek).forEach((day, k) => {
    html += '<div class="dcard"><div class="label">Giorno ' + (k + 1) + '</div>' +
      '<input class="field dark" data-in="dayName" data-k="' + k + '" placeholder="Nome (es. Push)" aria-label="Nome del giorno ' + (k + 1) + '" value="' + esc(day.name) + '" autocomplete="off">';
    day.items.forEach((it, m) => {
      const ex = exOf(it.exId);
      html += '<div class="irow"><span class="grow">' + esc(ex.name) + '</span>' +
        '<button type="button" class="btn small ghost" data-a="targetSheet" data-k="' + k + '" data-m="' + m + '" aria-label="Serie e ripetizioni">' + it.sets + ' × ' + it.reps + '</button>' +
        '<button type="button" class="iconbtn sm danger" data-a="draftRemoveItem" data-k="' + k + '" data-m="' + m + '" aria-label="Togli ' + esc(ex.name) + '">' + I.minus + '</button></div>';
    });
    html += '<button type="button" class="btn dashed full acc" data-a="draftAddItems" data-k="' + k + '">' + I.plus + ' Aggiungi esercizi</button></div>';
  });
  html += '</div><p class="muted sm">Serie × ripetizioni sono l\'obiettivo: servono a precompilare il primo allenamento e a suggerirti quando salire di peso.</p>' +
    '<button type="button" class="btn primary full big" data-a="savePlan">' + (edit ? 'Salva modifiche' : 'Crea scheda') + '</button></main>';
  return html;
}

/* ---------- Costanza ---------- */
function weekGoals() {
  /* per ogni settimana: obiettivo della scheda che la copre (la più recente) */
  const map = new Map();
  const today = todayISO();
  [...S.plans].sort((a, b) => (a.startDate < b.startDate ? -1 : 1)).forEach((p) => {
    const end = p.endedOn || today;
    let m = mondayOf(parseISO(p.startDate));
    const last = mondayOf(parseISO(end));
    while (m <= last) { map.set(isoOf(m), p.daysPerWeek); m = addDays(m, 7); }
  });
  return map;
}
function screenStreak() {
  const fin = finished();
  const today = todayISO();
  const thisWeek = weekKey(today);
  const countByWeek = new Map();
  fin.forEach((w) => { const k = weekKey(w.date); countByWeek.set(k, (countByWeek.get(k) || 0) + 1); });
  const goals = weekGoals();

  let streak = 0;
  let m = mondayOf(new Date());
  if ((countByWeek.get(thisWeek) || 0) < (goals.get(thisWeek) || Infinity)) m = addDays(m, -7);
  for (;;) {
    const k = isoOf(m); const g = goals.get(k);
    if (!g || (countByWeek.get(k) || 0) < g) break;
    streak++; m = addDays(m, -7);
  }
  let avg = '—';
  if (fin.length) {
    const first = fin[fin.length - 1].date;
    avg = fmtNum(Math.round(fin.length / (weeksBetween(first, today) + 1) * 10) / 10);
  }

  let html = '<main class="screen"><header class="hero"><h1>Costanza</h1><p class="muted">Un pallino per ogni allenamento fatto. Ogni settimana ha i pallini della sua scheda.</p></header>' +
    '<div class="tiles3">' + tile('Totale', fin.length, '') + tile('Media', avg, ' /sett.') + tile('Di fila', streak, ' sett.', true) + '</div>';

  const plans = [...S.plans].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  if (!plans.length) html += '<p class="empty">Crea una scheda e allenati: qui vedrai le settimane riempirsi.</p>';
  plans.forEach((p) => {
    const end = p.endedOn || today;
    const nWeeks = weeksBetween(p.startDate, end) + 1;
    const meta = plural(p.daysPerWeek, 'giorno', 'giorni') + ' · ' + (p.endedOn ? plural(nWeeks, 'settimana', 'settimane') : weekText(p, planWeekNo(p)).toLowerCase());
    html += '<div class="sec-h"><h2>' + esc(p.name) + '</h2><span class="muted sm">' + meta + '</span></div><div class="list">';
    let wk = mondayOf(parseISO(end));
    const start = mondayOf(parseISO(p.startDate));
    while (wk >= start) {
      const k = isoOf(wk);
      const c = fin.filter((w) => w.planId === p.id && weekKey(w.date) === k).length;
      const dots = Math.max(p.daysPerWeek, c);
      let dh = '';
      for (let i = 0; i < dots; i++) dh += '<span class="bigdot' + (i < c ? ' on' : '') + (i >= p.daysPerWeek ? ' extra' : '') + '"></span>';
      html += '<div class="wrow"><div class="grow"><div class="rt">' + weekRangeLabel(k) + '</div>' + (k === thisWeek ? '<div class="acc xs">Questa settimana</div>' : '') + '</div>' +
        '<div class="dots" role="img" aria-label="' + c + ' allenamenti su ' + p.daysPerWeek + '">' + dh + '</div><span class="cnt">' + c + '/' + p.daysPerWeek + '</span></div>';
      wk = addDays(wk, -7);
    }
    html += '</div>';
  });
  html += '</main>';
  return html;
}

/* ---------- Massimali ---------- */
function exerciseHistory(exId) {
  /* sessioni in ordine cronologico con le serie fatte */
  return finished().slice().reverse().map((w) => {
    const sets = [];
    w.items.forEach((it) => { if (it.exId === exId) doneSets(it).forEach((s) => sets.push(s)); });
    return sets.length ? { w, sets } : null;
  }).filter(Boolean);
}
function recordsList() {
  const used = new Set();
  finished().forEach((w) => w.items.forEach((it) => { if (doneSets(it).length) used.add(it.exId); }));
  return [...used].map((id) => {
    const ex = exOf(id); let best = null;
    exerciseHistory(id).forEach(({ w, sets }) => sets.forEach((s) => {
      const sc = setScore(ex, s);
      if (sc != null && (!best || sc > best.sc)) best = { sc, s, date: w.date };
    }));
    return best ? { ex, best } : null;
  }).filter(Boolean).sort((a, b) => (a.best.date < b.best.date ? 1 : -1));
}
function screenRecords() {
  const recs = recordsList();
  const now = new Date();
  const isNew = (iso) => { const d = parseISO(iso); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); };
  const newOnes = recs.filter((r) => isNew(r.best.date));
  const groups = ['Tutti'].concat(GROUPS.filter((g) => recs.some((r) => r.ex.group === g)));
  if (!groups.includes(S.massFilter)) S.massFilter = 'Tutti';
  const shown = recs.filter((r) => S.massFilter === 'Tutti' || r.ex.group === S.massFilter);

  let html = '<main class="screen"><header class="hero"><h1>Massimali</h1><p class="muted">Solo gli esercizi che hai fatto. 1RM stimato = peso × (1 + rip ÷ 30); a corpo libero conta la zavorra.</p></header>';
  if (!recs.length) return html + '<p class="empty">Finisci il primo allenamento e qui compariranno i tuoi record.</p></main>';
  if (newOnes.length) {
    html += '<div class="card acc-border iconrow"><span class="acc">' + I.trophy + '</span><div><div class="rt">' + plural(newOnes.length, 'record battuto', 'record battuti') + ' a ' + MONTHS_LONG[now.getMonth()] + '</div><div class="muted sm">L\'ultimo: ' + esc(newOnes[0].ex.name) + ', ' + dateShort(newOnes[0].best.date) + '</div></div></div>';
  }
  html += '<div class="chips scroll">' + groups.map((g) => '<button type="button" class="chip' + (g === S.massFilter ? ' on' : '') + '" aria-pressed="' + (g === S.massFilter) + '" data-a="massFilter" data-g="' + g + '">' + g + '</button>').join('') + '</div><div class="list">';
  html += shown.map((r) => {
    const s = r.best.s; let val; let label;
    if (r.ex.bw) {
      if ((s.kg || 0) > 0) { val = '+' + fmtNum(s.kg) + '<small> kg</small>'; label = 'Zavorra max'; } else { val = s.reps + '<small> rip</small>'; label = 'Rip max'; }
    } else { val = Math.round(r.best.sc) + '<small> kg</small>'; label = '1RM stimato'; }
    return '<a class="hrow" href="#/esercizio/' + encodeURIComponent(r.ex.id) + '"><div class="grow"><div class="rt">' + esc(r.ex.name) + (isNew(r.best.date) ? ' <span class="pr">NUOVO</span>' : '') + '</div>' +
      '<div class="muted sm">' + fmtKgUnit(s.kg, r.ex.bw) + ' × ' + s.reps + ' · ' + dateShort(r.best.date) + '</div></div>' +
      '<div class="rec"><div class="tv">' + val + '</div><div class="muted xs">' + label + '</div></div></a>';
  }).join('');
  html += '</div></main>';
  return html;
}

/* ---------- Progressi di un esercizio ---------- */
function screenExercise() {
  const ex = S.ex.get(S.route.id);
  if (!ex) { location.replace('#/massimali'); return null; }
  const all = exerciseHistory(ex.id);
  const days = { '1M': 31, '3M': 92, 'Tutto': 100000 }[S.range];
  const from = isoOf(addDays(new Date(), -days));
  const hist = all.filter((h) => h.w.date >= from);
  const useReps = ex.bw && all.every((h) => h.sets.every((s) => !(s.kg > 0)));
  const point = (h) => (useReps ? Math.max.apply(null, h.sets.map((s) => s.reps)) : Math.max.apply(null, h.sets.map((s) => s.kg || 0)));
  const unit = useReps ? ' rip' : ' kg';

  let html = '<main class="screen">' + topbar('#/massimali', ex.group, ex.name) +
    '<div class="chips fill">' + ['1M', '3M', 'Tutto'].map((r) => '<button type="button" class="chip' + (r === S.range ? ' on' : '') + '" aria-pressed="' + (r === S.range) + '" data-a="range" data-r="' + r + '">' + r + '</button>').join('') + '</div>';
  if (!hist.length) return html + '<p class="empty">Nessun allenamento in questo periodo.</p></main>';

  const maxKg = Math.max.apply(null, hist.map(point));
  const bestE = ex.bw ? null : Math.max.apply(null, hist.map((h) => Math.max.apply(null, h.sets.map((s) => e1rm(s.kg, s.reps)))));
  const lastH = hist[hist.length - 1];
  const lastVol = ex.bw ? lastH.sets.reduce((a, s) => a + s.reps, 0) : lastH.sets.reduce((a, s) => a + (s.kg || 0) * s.reps, 0);
  html += '<div class="tiles3">' +
    tile(useReps ? 'Rip max' : (ex.bw ? 'Zavorra max' : 'Carico max'), fmtNum(maxKg), unit) +
    (ex.bw ? tile('Sessioni', hist.length, '') : tile('1RM stimato', Math.round(bestE), ' kg')) +
    tile(ex.bw ? 'Rip ultima' : 'Volume ultima', Math.round(lastVol).toLocaleString('it-IT'), ex.bw ? '' : ' kg') + '</div>';

  const pts = hist.map((h) => ({ date: h.w.date, v: point(h) }));
  if (pts.length >= 2) {
    const delta = pts[pts.length - 1].v - pts[0].v;
    const wks = weeksBetween(pts[0].date, pts[pts.length - 1].date);
    const span = wks >= 1 ? plural(wks, 'settimana', 'settimane') : plural(pts.length, 'allenamento', 'allenamenti');
    html += '<div class="card"><div class="between"><span class="rt">' + (useReps ? 'Ripetizioni massime' : (ex.bw ? 'Zavorra massima' : 'Carico massimo')) + '</span><span class="acc sm b">' + (delta >= 0 ? '+' : '') + fmtNum(delta) + unit + ' in ' + span + '</span></div>' + chartSVG(pts, unit) + '</div>';
  } else {
    html += '<p class="muted sm">Servono almeno 2 allenamenti nel periodo per il grafico.</p>';
  }
  html += '<div class="sec-h"><h2>Allenamenti</h2></div><div class="list">' +
    hist.slice().reverse().map((h) => '<a class="hrow" href="#/riepilogo/' + h.w.id + '"><span class="rt nowrap">' + dateShort(h.w.date) + '</span><span class="muted sm right grow">' + esc(describeSets(ex, h.sets)) + '</span></a>').join('') + '</div></main>';
  return html;
}
function chartSVG(pts, unit) {
  const W = 326; const H = 190; const L = 36; const R = 10; const T = 12; const B = 28;
  let lo = Math.min.apply(null, pts.map((p) => p.v)); let hi = Math.max.apply(null, pts.map((p) => p.v));
  if (lo === hi) { lo -= 2.5; hi += 2.5; }
  lo = Math.floor(lo); hi = Math.ceil(hi);
  const x = (i) => L + (pts.length === 1 ? 0 : i * (W - L - R) / (pts.length - 1));
  const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Andamento da ' + fmtNum(pts[0].v) + ' a ' + fmtNum(pts[pts.length - 1].v) + unit + '">';
  ticks.forEach((t) => { s += '<line x1="' + L + '" x2="' + W + '" y1="' + y(t) + '" y2="' + y(t) + '" class="grid"/><text x="0" y="' + (y(t) + 4) + '" class="axis">' + fmtNum(Math.round(t * 10) / 10) + '</text>'; });
  s += '<polyline points="' + pts.map((p, i) => x(i) + ',' + y(p.v)).join(' ') + '" class="line"/>';
  pts.forEach((p, i) => { s += '<circle cx="' + x(i) + '" cy="' + y(p.v) + '" r="' + (i === pts.length - 1 ? 5.5 : 3) + '" class="pt' + (i === pts.length - 1 ? ' last' : '') + '"/>'; });
  const mid = Math.floor((pts.length - 1) / 2);
  s += '<text x="' + L + '" y="' + (H - 6) + '" class="axis">' + dateShort(pts[0].date) + '</text>';
  if (pts.length > 2) s += '<text x="' + x(mid) + '" y="' + (H - 6) + '" class="axis" text-anchor="middle">' + dateShort(pts[mid].date) + '</text>';
  s += '<text x="' + W + '" y="' + (H - 6) + '" class="axis" text-anchor="end">' + dateShort(pts[pts.length - 1].date) + '</text></svg>';
  return s;
}

/* ---------- Scelta esercizi (schermo intero) ---------- */
function openPicker(opts) {
  S.picker = Object.assign({ multi: true, selected: new Set(), exclude: new Set(), filter: 'Tutti', query: '', creating: false, newBw: false, newGroup: 'Petto', newName: '' }, opts);
  renderOverlay();
}
function pickerRows(list, p) {
  return list.map((e) => {
    const dis = p.exclude.has(e.id); const on = p.selected.has(e.id);
    return '<button type="button" class="prow' + (on ? ' on' : '') + '" data-a="pickEx" data-id="' + esc(e.id) + '"' + (dis ? ' disabled' : '') + ' aria-pressed="' + on + '">' +
      '<span class="grow"><span class="rt">' + esc(e.name) + '</span><span class="muted xs">' + esc(e.group) + (e.bw ? ' · corpo libero' : '') + (dis ? ' · già presente' : '') + '</span></span>' +
      '<span class="radio">' + (on ? I.check : '') + '</span></button>';
  }).join('');
}
function pickerListHTML() {
  const p = S.picker; const q = norm(p.query);
  const match = (e) => (p.filter === 'Tutti' || e.group === p.filter) && (!q || norm(e.name).includes(q));
  const sorted = [...S.ex.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const mine = sorted.filter((e) => !e.builtin && match(e));
  const base = sorted.filter((e) => e.builtin && match(e));
  let h = '';
  if (mine.length) h += '<div class="label sec">Creati da te</div><div class="plist">' + pickerRows(mine, p) + '</div>';
  if (base.length) h += '<div class="label sec">Predefiniti</div><div class="plist">' + pickerRows(base, p) + '</div>';
  if (!mine.length && !base.length) h += '<p class="empty">Nessun esercizio trovato. Crealo tu con il pulsante qui sopra.</p>';
  return h;
}
function renderOverlay() {
  const p = S.picker;
  if (!p) { $overlay.innerHTML = ''; $overlay.hidden = true; document.body.classList.remove('locked'); return; }
  const body = $overlay.querySelector('.ov-body');
  const keep = body ? body.scrollTop : 0;
  $overlay.hidden = false; document.body.classList.add('locked');
  const n = p.selected.size;
  let h = '<div class="ov" role="dialog" aria-modal="true" aria-label="Scegli esercizi"><div class="ov-head">' +
    '<div class="topbar"><button type="button" class="iconbtn" data-a="closePicker" aria-label="Chiudi">' + I.back + '</button><div class="tb-title"><div class="t">' + (p.multi ? 'Scegli esercizi' : 'Scegli esercizio') + '</div></div></div>' +
    '<input class="field" type="search" data-in="pickerQuery" placeholder="Cerca esercizio" aria-label="Cerca esercizio" value="' + esc(p.query) + '" autocomplete="off">' +
    '<div class="chips scroll">' + ['Tutti'].concat(GROUPS).map((g) => '<button type="button" class="chip' + (g === p.filter ? ' on' : '') + '" aria-pressed="' + (g === p.filter) + '" data-a="pickerFilter" data-g="' + g + '">' + g + '</button>').join('') + '</div></div>' +
    '<div class="ov-body"><button type="button" class="btn dashed full acc" data-a="pickerCreate">' + I.plus + ' Crea nuovo esercizio</button><div id="pickerList">' + pickerListHTML() + '</div></div>';
  if (p.multi) h += '<div class="ov-foot"><button type="button" class="btn primary full big" data-a="pickerDone"' + (n ? '' : ' disabled') + '>' + (n ? 'Aggiungi (' + n + ')' : 'Seleziona gli esercizi') + '</button></div>';
  if (p.creating) {
    h += '<div class="backdrop" data-a="pickerCreateCancel"><div class="sheetpanel" data-a="noop" role="dialog" aria-label="Nuovo esercizio"><div class="sheet-t">Nuovo esercizio</div>' +
      '<input class="field dark" id="newExName" data-in="newExName" placeholder="Nome dell\'esercizio" aria-label="Nome dell\'esercizio" value="' + esc(p.newName) + '" autocomplete="off">' +
      '<div class="flabel">Muscolo principale</div><div class="chips wrap">' + GROUPS.map((g) => '<button type="button" class="chip' + (g === p.newGroup ? ' on' : '') + '" aria-pressed="' + (g === p.newGroup) + '" data-a="newExGroup" data-g="' + g + '">' + g + '</button>').join('') + '</div>' +
      '<button type="button" class="switchrow" data-a="newExBw" aria-pressed="' + p.newBw + '"><span class="grow"><span class="rt">Corpo libero</span><span class="muted xs">Il peso diventa la zavorra: CL, CL+5…</span></span><span class="switch' + (p.newBw ? ' on' : '') + '"><span></span></span></button>' +
      '<div class="row2"><button type="button" class="btn ghost" data-a="pickerCreateCancel">Annulla</button><button type="button" class="btn primary" data-a="pickerCreateSave">Salva</button></div></div></div>';
  }
  h += '</div>';
  $overlay.innerHTML = h;
  const nb = $overlay.querySelector('.ov-body');
  if (nb) nb.scrollTop = keep;
}

/* ---------- Fogli in basso ---------- */
function openSheet(s) { S.sheet = s; renderSheet(); }
function closeSheet() { S.sheet = null; renderSheet(); }
function renderSheet() {
  const s = S.sheet;
  if (!s) { $sheet.innerHTML = ''; $sheet.hidden = true; if (!S.picker) document.body.classList.remove('locked'); return; }
  $sheet.hidden = false; document.body.classList.add('locked');
  let inner = '';
  if (s.type === 'set') {
    const w = getWorkout(s.wid); const it = w.items[s.i]; const set = it.sets[s.j]; const ex = exOf(it.exId);
    inner = '<div class="sheet-t">' + esc(ex.name) + ' · serie ' + (s.j + 1) + '</div>' +
      '<div class="flabel">' + (ex.bw ? 'Zavorra (kg) · 0 = solo corpo libero' : 'Peso (kg)') + '</div>' +
      '<div class="bigstep"><button type="button" class="st-big" data-a="bump" data-f="kg" data-d="-' + KG_STEP + '" aria-label="Togli 2,5 kg">−</button>' +
      '<input class="numin" id="inKg" data-in="setKg" inputmode="decimal" enterkeyhint="next" aria-label="Peso in kg" value="' + (set.kg == null ? '' : fmtNum(set.kg)) + '" placeholder="' + (ex.bw ? '0' : 'kg') + '">' +
      '<button type="button" class="st-big plus" data-a="bump" data-f="kg" data-d="' + KG_STEP + '" aria-label="Aggiungi 2,5 kg">+</button></div>' +
      '<div class="flabel">Ripetizioni</div>' +
      '<div class="bigstep"><button type="button" class="st-big" data-a="bump" data-f="reps" data-d="-1" aria-label="Togli una ripetizione">−</button>' +
      '<input class="numin" id="inReps" data-in="setReps" inputmode="numeric" enterkeyhint="done" aria-label="Ripetizioni" value="' + (set.reps == null ? '' : set.reps) + '">' +
      '<button type="button" class="st-big plus" data-a="bump" data-f="reps" data-d="1" aria-label="Aggiungi una ripetizione">+</button></div>' +
      '<p class="muted xs center">− e + cambiano di 2,5 kg; oppure tocca il numero e scrivilo.</p>' +
      '<div class="row2"><button type="button" class="btn ghost danger" data-a="delSet">Elimina serie</button><button type="button" class="btn primary" data-a="setDone">' + (set.done ? 'Fatto' : 'Fatto e spunta') + '</button></div>';
  } else if (s.type === 'note') {
    const w = getWorkout(s.wid); const it = w.items[s.i]; const ex = exOf(it.exId);
    inner = '<div class="sheet-t">' + esc(ex.name) + '</div>' +
      '<label class="flabel" for="noteToday">Nota di oggi</label><textarea id="noteToday" class="field dark area" placeholder="Es. ultima al cedimento">' + esc(it.note) + '</textarea>' +
      '<label class="flabel" for="noteFixed">Nota fissa (compare ogni volta)</label><textarea id="noteFixed" class="field dark area" placeholder="Es. sedile al 4">' + esc(ex.fixedNote || '') + '</textarea>' +
      '<button type="button" class="btn primary full" data-a="noteSave">Salva</button>';
  } else if (s.type === 'finish') {
    inner = '<div class="sheet-t">' + plural(s.left, 'serie non spuntata', 'serie non spuntate') + '</div><p class="muted">Le hai fatte o le salti?</p>' +
      '<div class="col"><button type="button" class="btn primary full" data-a="finishMode" data-m="all">Segna come fatte e termina</button>' +
      '<button type="button" class="btn ghost full" data-a="finishMode" data-m="drop">Scartale e termina</button>' +
      '<button type="button" class="linkbtn center" data-a="closeSheet">Continua l\'allenamento</button></div>';
  } else if (s.type === 'target') {
    const it = S.draft.allDays[s.k].items[s.m];
    inner = '<div class="sheet-t">' + esc(exOf(it.exId).name) + '</div>' +
      '<div class="between gapy"><span class="rt">Serie</span>' + stepper('targetBump', it.sets, 'serie', ' data-f="sets"') + '</div>' +
      '<div class="between gapy"><span class="rt">Ripetizioni</span>' + stepper('targetBump', it.reps, 'ripetizioni', ' data-f="reps"') + '</div>' +
      '<button type="button" class="btn primary full" data-a="closeSheet">Fatto</button>';
  } else if (s.type === 'import') {
    const d = s.data;
    inner = '<div class="sheet-t">Importare il backup?</div><p class="muted">Backup del ' + esc(new Date(d.exportedAt).toLocaleDateString('it-IT')) + ': ' + plural(d.workouts.length, 'allenamento', 'allenamenti') + ', ' + plural(d.plans.length, 'scheda', 'schede') + '. Prende il posto dei dati attuali (puoi annullare subito dopo).</p>' +
      '<div class="row2"><button type="button" class="btn ghost" data-a="closeSheet">Annulla</button><button type="button" class="btn primary" data-a="importConfirm">Importa</button></div>';
  }
  $sheet.innerHTML = '<div class="backdrop" data-a="sheetBackdrop"><div class="sheetpanel" data-a="noop" role="dialog" aria-modal="true">' + inner + '</div></div>';
}

/* ---------- Azioni ---------- */
const A = {
  noop() {},
  undo() { const u = toastUndo; hideToast(); if (u) u(); },
  more() { S.histLimit += 20; render(); },
  homeDay(d) { S.homeDay = d.day; render(); },
  start(d) { startWorkout(d.day); },
  newPlan() { S.draft = blankDraft(); go('#/nuova'); },
  editPlan() {
    const p = activePlan(); if (!p) return;
    const days = p.days.map((x) => ({ id: x.id, name: x.name, items: x.items.map((i) => ({ ...i })) }));
    S.draft = { editId: p.id, name: p.name, weeks: p.weeks, daysPerWeek: p.daysPerWeek, allDays: days };
    go('#/nuova');
  },
  async planWeeks(d) {
    const p = activePlan(); if (!p) return;
    const min = Math.max(1, planWeekNo(p));
    p.weeks = Math.min(104, Math.max(min, p.weeks + Number(d.d)));
    await savePlan(p); render();
  },
  draftWeeks(d) { S.draft.weeks = Math.min(104, Math.max(1, S.draft.weeks + Number(d.d))); render(); },
  draftDays(d) { S.draft.daysPerWeek = Number(d.n); render(); },
  draftRemoveItem(d) {
    const day = S.draft.allDays[d.k]; const [it] = day.items.splice(d.m, 1); render();
    toast(exOf(it.exId).name + ' tolto', () => { day.items.splice(d.m, 0, it); render(); });
  },
  draftAddItems(d) {
    const day = S.draft.allDays[d.k];
    openPicker({ exclude: new Set(day.items.map((i) => i.exId)), onDone: (ids) => { ids.forEach((id) => day.items.push({ exId: id, sets: 3, reps: 10 })); render(); } });
  },
  targetSheet(d) { openSheet({ type: 'target', k: Number(d.k), m: Number(d.m) }); },
  targetBump(d) {
    const s = S.sheet; const it = S.draft.allDays[s.k].items[s.m];
    if (d.f === 'sets') it.sets = Math.min(10, Math.max(1, it.sets + Number(d.d)));
    else it.reps = Math.min(100, Math.max(1, it.reps + Number(d.d)));
    renderSheet();
  },
  async savePlan() {
    const d = S.draft;
    const name = d.name.trim();
    if (!name) { toast('Dai un nome alla scheda'); document.getElementById('planName').focus(); return; }
    const days = d.allDays.slice(0, d.daysPerWeek);
    for (let k = 0; k < days.length; k++) {
      if (!days[k].name.trim()) days[k].name = 'Giorno ' + (k + 1);
      if (!days[k].items.length) { toast('Aggiungi almeno un esercizio a ' + days[k].name); return; }
    }
    const cleanDays = days.map((x) => ({ id: x.id, name: x.name.trim(), items: x.items.map((i) => ({ exId: i.exId, sets: i.sets, reps: i.reps })) }));
    if (d.editId) {
      const p = S.plans.find((x) => x.id === d.editId);
      p.name = name; p.weeks = d.weeks; p.days = cleanDays;
      await savePlan(p);
    } else {
      const today = todayISO();
      const old = activePlan();
      if (old) { old.endedOn = today; await savePlan(old); }
      const p = { id: uid('p'), name, weeks: d.weeks, daysPerWeek: d.daysPerWeek, startDate: today, endedOn: null, createdAt: Date.now(), days: cleanDays };
      S.plans.push(p);
      await savePlan(p);
    }
    S.draft = null; safetyCopy();
    toast(d.editId ? 'Scheda aggiornata' : 'Scheda creata');
    go('#/scheda');
  },

  /* allenamento */
  editSet(d) { openSheet({ type: 'set', wid: S.route.id, i: Number(d.i), j: Number(d.j) }); },
  async toggleSet(d) {
    const w = getWorkout(S.route.id); const s = w.items[d.i].sets[d.j];
    s.done = !s.done;
    if (s.done && navigator.vibrate) navigator.vibrate(15);
    render(); await saveWorkout(w);
  },
  async addSet(d) {
    const w = getWorkout(S.route.id); const it = w.items[d.i]; const ex = exOf(it.exId);
    const src = it.sets[it.sets.length - 1];
    it.sets.push({ kg: src ? src.kg : (ex.bw ? 0 : null), reps: src ? src.reps : 10, done: false });
    render(); await saveWorkout(w);
  },
  async bump(d) {
    const s = S.sheet; const w = getWorkout(s.wid); const set = w.items[s.i].sets[s.j];
    if (d.f === 'kg') set.kg = Math.max(0, Math.round(((set.kg || 0) + Number(d.d)) * 100) / 100);
    else set.reps = Math.max(0, (set.reps || 0) + Number(d.d));
    const inp = document.getElementById(d.f === 'kg' ? 'inKg' : 'inReps');
    if (inp) inp.value = d.f === 'kg' ? fmtNum(set.kg) : set.reps;
    if (d.f === 'kg') fillEmptyAfter(w.items[s.i], s.j);
    await saveWorkout(w);
  },
  async setDone() {
    const s = S.sheet; const w = getWorkout(s.wid); const set = w.items[s.i].sets[s.j];
    set.done = true; closeSheet(); render(); await saveWorkout(w);
  },
  async delSet() {
    const s = S.sheet; const w = getWorkout(s.wid); const it = w.items[s.i];
    const [removed] = it.sets.splice(s.j, 1);
    closeSheet(); render(); await saveWorkout(w);
    toast('Serie eliminata', async () => { it.sets.splice(s.j, 0, removed); render(); await saveWorkout(w); });
  },
  noteSheet(d) { openSheet({ type: 'note', wid: S.route.id, i: Number(d.i) }); },
  async noteSave() {
    const s = S.sheet; const w = getWorkout(s.wid); const it = w.items[s.i]; const ex = S.ex.get(it.exId);
    it.note = document.getElementById('noteToday').value.trim();
    const fixed = document.getElementById('noteFixed').value.trim();
    closeSheet(); render(); await saveWorkout(w);
    if (ex && fixed !== (ex.fixedNote || '')) { ex.fixedNote = fixed; await DB.put('exercises', ex); render(); }
  },
  finish(d) {
    const w = getWorkout(d.w); if (!w) return;
    const left = w.items.reduce((a, it) => a + it.sets.filter((s) => !s.done).length, 0);
    if (left) {
      const sheet = { type: 'finish', wid: w.id, left };
      if (S.route.name === 'allenamento' && S.route.id === w.id) openSheet(sheet);
      else { S.afterNav = sheet; go('#/allenamento/' + w.id); }
      return;
    }
    finishWorkout(w, 'all');
  },
  finishMode(d) { const w = getWorkout(S.sheet.wid); closeSheet(); finishWorkout(w, d.m); },
  async discardWorkout(d) {
    const w = getWorkout(d.w); if (!w) return;
    S.workouts = S.workouts.filter((x) => x.id !== w.id);
    await DB.del('workouts', w.id);
    go('#/');
    toast('Allenamento eliminato', async () => { S.workouts.push(w); await DB.put('workouts', w); go('#/allenamento/' + w.id); });
  },
  async deleteWorkout(d) {
    const w = getWorkout(d.w); if (!w) return;
    S.workouts = S.workouts.filter((x) => x.id !== w.id);
    await DB.del('workouts', w.id); safetyCopy();
    go('#/');
    toast('Allenamento eliminato', async () => { S.workouts.push(w); await DB.put('workouts', w); safetyCopy(); render(); });
  },

  /* modifica allenamento */
  async removeItem(d) {
    const w = getWorkout(S.route.id); const i = Number(d.i);
    const [it] = w.items.splice(i, 1);
    render(); await saveWorkout(w);
    toast(exOf(it.exId).name + ' tolto', async () => { w.items.splice(i, 0, it); render(); await saveWorkout(w); });
  },
  async moveItem(d) {
    const w = getWorkout(S.route.id); const i = Number(d.i); const j = i + Number(d.d);
    if (j < 0 || j >= w.items.length) return;
    const [it] = w.items.splice(i, 1); w.items.splice(j, 0, it);
    render(); await saveWorkout(w);
  },
  swapItem(d) {
    const w = getWorkout(S.route.id); const i = Number(d.i);
    openPicker({ multi: false, exclude: new Set(w.items.map((x) => x.exId)), onDone: async (ids) => {
      const old = w.items[i];
      w.items[i] = buildItem(ids[0], old.sets.length, null, w);
      render(); await saveWorkout(w);
      toast('Esercizio cambiato', async () => { w.items[i] = old; render(); await saveWorkout(w); });
    } });
  },
  addItems() {
    const w = getWorkout(S.route.id);
    openPicker({ exclude: new Set(w.items.map((x) => x.exId)), onDone: async (ids) => {
      ids.forEach((id) => w.items.push(buildItem(id, null, null, w)));
      render(); await saveWorkout(w);
    } });
  },

  /* scelta esercizi */
  closePicker() { S.picker = null; renderOverlay(); },
  pickerFilter(d) { S.picker.filter = d.g; renderOverlay(); },
  pickEx(d) {
    const p = S.picker;
    if (!p.multi) { const cb = p.onDone; S.picker = null; renderOverlay(); cb([d.id]); return; }
    if (p.selected.has(d.id)) p.selected.delete(d.id); else p.selected.add(d.id);
    renderOverlay();
  },
  pickerDone() { const p = S.picker; const ids = [...p.selected]; S.picker = null; renderOverlay(); p.onDone(ids); },
  pickerCreate() {
    S.picker.creating = true; S.picker.newName = S.picker.query; S.picker.newBw = false;
    S.picker.newGroup = S.picker.filter !== 'Tutti' ? S.picker.filter : 'Petto';
    renderOverlay();
    setTimeout(() => { const el = document.getElementById('newExName'); if (el) el.focus(); }, 50);
  },
  pickerCreateCancel() { S.picker.creating = false; renderOverlay(); },
  newExGroup(d) { S.picker.newGroup = d.g; renderOverlay(); },
  newExBw() { S.picker.newBw = !S.picker.newBw; renderOverlay(); },
  async pickerCreateSave() {
    const p = S.picker; const name = p.newName.trim().replace(/\s+/g, ' ');
    if (!name) { toast('Scrivi il nome dell\'esercizio'); return; }
    const dup = [...S.ex.values()].find((e) => norm(e.name) === norm(name));
    let id;
    if (dup) {
      id = dup.id; toast('Esiste già: ' + dup.name + '. L\'ho selezionato.');
    } else {
      const ex = { id: uid('c'), name: name.charAt(0).toUpperCase() + name.slice(1), group: p.newGroup, bw: p.newBw, builtin: false, fixedNote: '' };
      S.ex.set(ex.id, ex); await DB.put('exercises', ex); id = ex.id;
    }
    p.creating = false; p.query = '';
    if (p.exclude.has(id)) { renderOverlay(); return; }
    if (!p.multi) { const cb = p.onDone; S.picker = null; renderOverlay(); cb([id]); return; }
    p.selected.add(id); renderOverlay();
  },

  /* fogli */
  closeSheet() { closeSheet(); render(); },
  sheetBackdrop(d, el, e) { if (e.target === el) { closeSheet(); render(); } },

  /* viste */
  massFilter(d) { S.massFilter = d.g; render(); },
  range(d) { S.range = d.r; render(); },

  /* backup */
  export() { doExport('json'); },
  exportCsv() { doExport('csv'); },
  import() { document.getElementById('importFile').click(); },
  async importConfirm() {
    const data = S.sheet.data; closeSheet();
    const prev = exportData();
    try {
      await DB.replaceAll(data); await loadAll(); safetyCopy();
      go('#/');
      toast('Backup importato', async () => { await DB.replaceAll(prev); await loadAll(); safetyCopy(); render(); });
    } catch (e) { toast('Importazione non riuscita: il file non è valido'); }
  },
  async restoreSafety() {
    const data = S.safetyFound; S.safetyFound = null;
    try { await DB.replaceAll(data); await loadAll(); toast('Dati ripristinati'); } catch (e) { toast('Ripristino non riuscito'); }
    render();
  },
  dismissSafety() { S.safetyFound = null; render(); }
};

async function finishWorkout(w, mode) {
  w.items.forEach((it) => {
    if (mode === 'drop') it.sets = it.sets.filter((s) => s.done);
    else it.sets.forEach((s) => { s.done = true; });
  });
  w.items = w.items.filter((it) => it.sets.length);
  if (!w.items.length) {
    S.workouts = S.workouts.filter((x) => x.id !== w.id);
    await DB.del('workouts', w.id);
    toast('Nessuna serie fatta: allenamento non salvato');
    go('#/'); return;
  }
  w.endedAt = Date.now();
  await saveWorkout(w);
  safetyCopy();
  S.justFinished = w.id;
  go('#/riepilogo/' + w.id);
}

/* ---------- Input da tastiera ---------- */
let inputSaveTimer = null;
const IN = {
  draftName(el) { S.draft.name = el.value; },
  dayName(el) { S.draft.allDays[el.dataset.k].name = el.value; },
  pickerQuery(el) { S.picker.query = el.value; document.getElementById('pickerList').innerHTML = pickerListHTML(); },
  newExName(el) { S.picker.newName = el.value; },
  setKg(el) { setField('kg', parseNum(el.value)); },
  setReps(el) { const v = parseNum(el.value); setField('reps', v == null ? null : Math.round(v)); }
};
/* Il peso scritto in una serie riempie le serie successive ancora vuote. */
function fillEmptyAfter(item, j) {
  const kg = item.sets[j].kg;
  if (kg == null) return;
  for (let k = j + 1; k < item.sets.length; k++) {
    if (item.sets[k].kg == null && !item.sets[k].done) item.sets[k].kg = kg;
  }
}
function setField(f, v) {
  const s = S.sheet; if (!s) return;
  const w = getWorkout(s.wid); const set = w.items[s.i].sets[s.j];
  set[f] = v == null ? (f === 'kg' && exOf(w.items[s.i].exId).bw ? 0 : null) : Math.max(0, v);
  if (f === 'kg') fillEmptyAfter(w.items[s.i], s.j);
  clearTimeout(inputSaveTimer);
  inputSaveTimer = setTimeout(() => saveWorkout(w), 250);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (!fn) return;
  if (el.dataset.a === 'noop') return;
  e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-in]');
  if (el && IN[el.dataset.in]) IN[el.dataset.in](el);
});
document.addEventListener('focusin', (e) => {
  if (e.target.classList && e.target.classList.contains('numin')) setTimeout(() => e.target.select(), 0);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'inKg') { e.preventDefault(); const r = document.getElementById('inReps'); if (r) r.focus(); }
  else if (e.key === 'Enter' && e.target.id === 'inReps') { e.preventDefault(); e.target.blur(); }
});

/* ---------- Backup su file ---------- */
function csvCell(v) { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCSV() {
  const rows = [['Data', 'Scheda', 'Giorno', 'Esercizio', 'Gruppo', 'Serie', 'Kg', 'Ripetizioni', 'Corpo libero', 'Nota']];
  finished().slice().reverse().forEach((w) => {
    const plan = S.plans.find((p) => p.id === w.planId);
    w.items.forEach((it) => {
      const ex = exOf(it.exId);
      doneSets(it).forEach((s, j) => rows.push([w.date, plan ? plan.name : '', w.dayName, ex.name, ex.group, j + 1, s.kg == null ? '' : fmtNum(s.kg), s.reps, ex.bw ? 'sì' : '', j === 0 ? it.note : '']));
    });
  });
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function doExport(kind) {
  const stamp = todayISO();
  const file = kind === 'csv'
    ? new File([toCSV()], 'gymlog-' + stamp + '.csv', { type: 'text/csv' })
    : new File([JSON.stringify(exportData())], 'gymlog-backup-' + stamp + '.json', { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: kind === 'csv' ? 'Gym Log CSV' : 'Backup Gym Log' });
    } else {
      downloadFile(file);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    downloadFile(file);
  }
  if (kind !== 'csv') {
    S.lastBackup = Date.now();
    await DB.setMeta('lastBackup', S.lastBackup);
    toast('Backup pronto');
  }
  render();
}
document.getElementById('importFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'gymlog' || !Array.isArray(data.workouts) || !Array.isArray(data.plans) || !Array.isArray(data.exercises)) throw new Error('formato');
    openSheet({ type: 'import', data });
  } catch (err) {
    toast('Questo file non è un backup di Gym Log');
  }
});

/* ---------- Schermo acceso durante l'allenamento ---------- */
let wakeLock = null;
async function updateWakeLock() {
  const w = S.route.name === 'allenamento' ? getWorkout(S.route.id) : null;
  const want = !!(w && !w.endedAt && document.visibilityState === 'visible');
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  } else if (!want && wakeLock) {
    try { await wakeLock.release(); } catch (e) { /* già rilasciato */ }
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', updateWakeLock);

/* ---------- Avvio ---------- */
async function boot() {
  try {
    await DB.open();
    await loadAll();
  } catch (e) {
    $app.innerHTML = '<main class="screen"><header class="hero"><h1>Gym Log</h1></header><div class="card warn"><div class="card-t">Archivio non disponibile</div><p class="muted">Il browser non permette di salvare dati (forse sei in navigazione privata). Apri l\'app normalmente o dalla schermata Home.</p></div></main>';
    return;
  }
  if (!S.workouts.length) {
    try {
      const raw = localStorage.getItem('gymlog-safety');
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.workouts) && data.workouts.length) S.safetyFound = data;
    } catch (e) { /* niente copia */ }
  }
  S.route = parseRoute();
  render(true);
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) { /* non supportato */ }
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
boot();

// app.js - interfaccia: griglia virtualizzata, selezione, editing, tastiera, installazione PWA
import { MAX_ROWS, MAX_COLS, colName, toKey, parseRef } from './coordinates.js';
import { Sheet, formatValue, isErr, ERR_HELP } from './engine.js';

const CW = 96, RH = 30, BUF = 2; // larghezza/altezza cella (px) e celle extra attorno al viewport
const STORE_KEY = 'mini-sheet-pwa:v1';
const $ = (s) => document.querySelector(s);

const vp = $('#viewport'), sizer = $('#sizer'), layer = $('#cells');
const colInner = $('#colHeadersInner'), rowInner = $('#rowHeadersInner');
const bar = $('#formulaBar'), nameBox = $('#nameBox'), status = $('#status');

// le dimensioni reali arrivano dal CSS (media query mobile): le rileggiamo
const css = getComputedStyle(document.documentElement);
let cw = parseFloat(css.getPropertyValue('--cw')) || CW;
let rh = parseFloat(css.getPropertyValue('--rh')) || RH;
function readSizes() {
  const s = getComputedStyle(document.documentElement);
  cw = parseFloat(s.getPropertyValue('--cw')) || CW;
  rh = parseFloat(s.getPropertyValue('--rh')) || RH;
  sizer.style.width = MAX_COLS * cw + 'px';
  sizer.style.height = MAX_ROWS * rh + 'px';
  colInner.style.width = MAX_COLS * cw + 'px';
  rowInner.style.height = MAX_ROWS * rh + 'px';
}

const sheet = new Sheet();
let sel = { r: 0, c: 0 };
let editing = null; // {r, c} mentre si scrive in una cella

/* ---------------- Persistenza (localStorage) ---------------- */
const SEED = { // esempi dei casi di test, solo al primo avvio
  A1: '5', A2: '10', A3: '=SOMMA(A1:A2)',
  B1: '0', B2: '=A1/B1', C1: '=C1',
  D1: '=CONTA.SE(A1:A10;">5")', D2: '=MEDIA(A1:A3)'
};
function loadStore() {
  try { const s = localStorage.getItem(STORE_KEY); if (s) { sheet.load(JSON.parse(s)); return true; } } catch { /* ignora */ }
  return false;
}
let saveTimer = 0;
function scheduleSave() { // debounce: salva 300 ms dopo l'ultima modifica
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(sheet.toJSON())); } catch { /* ignora */ } }, 300);
}
if (!loadStore()) sheet.load(SEED);

/* ---------------- Intestazioni (200 div statici) ---------------- */
const colHdrs = [], rowHdrs = [];
function buildHeaders() {
  const fc = document.createDocumentFragment(), fr = document.createDocumentFragment();
  for (let c = 0; c < MAX_COLS; c++) {
    const d = document.createElement('div');
    d.className = 'hdr'; d.style.left = c * cw + 'px'; d.textContent = colName(c);
    colHdrs.push(d); fc.appendChild(d);
  }
  for (let r = 0; r < MAX_ROWS; r++) {
    const d = document.createElement('div');
    d.className = 'hdr'; d.style.top = r * rh + 'px'; d.textContent = r + 1;
    rowHdrs.push(d); fr.appendChild(d);
  }
  colInner.appendChild(fc); rowInner.appendChild(fr);
}

/* ---------------- VIRTUALIZZAZIONE ----------------
 * Nel DOM ci sono solo le celle dentro (o vicino) al viewport: ~30x15 + buffer,
 * mai 10.000. `pool` mappa id cella -> elemento. Ad ogni scroll togliamo le celle
 * uscite e creiamo quelle entrate. Le celle sono absolute (left/top calcolati). */
const pool = new Map();
const id = (r, c) => r * MAX_COLS + c;

function paint(el, r, c) {
  const v = sheet.getValue(toKey(r, c));
  const t = formatValue(v);
  if (el.textContent !== t) el.textContent = t;
  const cls = 'cell' + (typeof v === 'number' ? ' num' : '') + (isErr(v) ? ' err' : '') + (r === sel.r && c === sel.c ? ' sel' : '');
  if (el.className !== cls) el.className = cls;
  if (isErr(v)) el.title = ERR_HELP[v.code] || ''; else if (el.title) el.removeAttribute('title');
}

function render() {
  const top = vp.scrollTop, left = vp.scrollLeft;
  const r0 = Math.max(0, Math.floor(top / rh) - BUF);
  const r1 = Math.min(MAX_ROWS - 1, Math.ceil((top + vp.clientHeight) / rh) + BUF);
  const c0 = Math.max(0, Math.floor(left / cw) - BUF);
  const c1 = Math.min(MAX_COLS - 1, Math.ceil((left + vp.clientWidth) / cw) + BUF);

  for (const [k, el] of pool) { // rimuove le celle uscite dal viewport
    const r = (k / MAX_COLS) | 0, c = k % MAX_COLS;
    if (r < r0 || r > r1 || c < c0 || c > c1) { el.remove(); pool.delete(k); }
  }
  const frag = document.createDocumentFragment();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = id(r, c);
      if (pool.has(k)) continue;
      const el = document.createElement('div');
      el.style.left = c * cw + 'px'; el.style.top = r * rh + 'px';
      paint(el, r, c);
      pool.set(k, el); frag.appendChild(el);
    }
  }
  layer.appendChild(frag);
}
function refreshVisible() { for (const [k, el] of pool) paint(el, (k / MAX_COLS) | 0, k % MAX_COLS); }

let raf = 0;
vp.addEventListener('scroll', () => {
  // intestazioni sincronizzate con la griglia (transform = nessun reflow)
  colInner.style.transform = `translateX(${-vp.scrollLeft}px)`;
  rowInner.style.transform = `translateY(${-vp.scrollTop}px)`;
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); // max 1 render per frame
}, { passive: true });
window.addEventListener('resize', () => { readSizes(); relayout(); });

function relayout() { // dopo un cambio di dimensioni (es. rotazione schermo)
  colHdrs.forEach((d, c) => { d.style.left = c * cw + 'px'; });
  rowHdrs.forEach((d, r) => { d.style.top = r * rh + 'px'; });
  pool.forEach((el) => el.remove()); pool.clear();
  render();
}

/* ---------------- Selezione ---------------- */
const clamp = (v, max) => Math.max(0, Math.min(max - 1, v));
function ensureVisible(r, c) {
  const x = c * cw, y = r * rh;
  if (x < vp.scrollLeft) vp.scrollLeft = x;
  else if (x + cw > vp.scrollLeft + vp.clientWidth) vp.scrollLeft = x + cw - vp.clientWidth;
  if (y < vp.scrollTop) vp.scrollTop = y;
  else if (y + rh > vp.scrollTop + vp.clientHeight) vp.scrollTop = y + rh - vp.clientHeight;
}
function syncBar() {
  const k = toKey(sel.r, sel.c);
  nameBox.textContent = k;
  bar.value = sheet.getRaw(k);
  const v = sheet.getValue(k);
  status.textContent = isErr(v) ? `${v.code} — ${ERR_HELP[v.code] || ''}` : 'Pronto.';
  status.classList.toggle('text-danger', isErr(v));
}
function select(r, c, { scroll = true } = {}) {
  const old = sel;
  colHdrs[old.c].classList.remove('active'); rowHdrs[old.r].classList.remove('active');
  sel = { r, c };
  colHdrs[c].classList.add('active'); rowHdrs[r].classList.add('active');
  const oe = pool.get(id(old.r, old.c)); if (oe) oe.classList.remove('sel');
  if (scroll) ensureVisible(r, c);
  render();
  const ne = pool.get(id(r, c)); if (ne) ne.classList.add('sel');
  syncBar();
}
const move = (dr, dc) => select(clamp(sel.r + dr, MAX_ROWS), clamp(sel.c + dc, MAX_COLS));

/* ---------------- Modifica cella ---------------- */
const ed = document.createElement('input');
ed.id = 'editor'; ed.type = 'text'; ed.autocomplete = 'off'; ed.spellcheck = false;
ed.setAttribute('autocapitalize', 'off');
layer.appendChild(ed);

function commit(value, r, c) {
  const k = toKey(r, c);
  if (sheet.getRaw(k) === value) return;
  const dirty = sheet.setRaw(k, value); // celle toccate = lei + dipendenti
  sheet.recalc(dirty);                  // ricalcola solo quelle
  refreshVisible();
  scheduleSave();
}
function startEdit(r, c, initial) {
  editing = { r, c };
  ed.style.display = 'block';
  ed.style.left = c * cw + 'px'; ed.style.top = r * rh + 'px';
  ed.value = initial !== undefined ? initial : sheet.getRaw(toKey(r, c));
  ed.style.width = Math.max(cw, ed.value.length * 9 + 24) + 'px';
  ed.focus();
  bar.value = ed.value;
}
function endEdit(save) {
  if (!editing) return;
  const { r, c } = editing, v = ed.value;
  editing = null;
  ed.style.display = 'none';
  if (save) commit(v, r, c);
  syncBar();
}
ed.addEventListener('input', () => { bar.value = ed.value; ed.style.width = Math.max(cw, ed.value.length * 9 + 24) + 'px'; });
ed.addEventListener('blur', () => endEdit(true));
ed.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); endEdit(true); vp.focus({ preventScroll: true }); move(e.shiftKey ? -1 : 1, 0); }
  else if (e.key === 'Tab') { e.preventDefault(); endEdit(true); vp.focus({ preventScroll: true }); move(0, e.shiftKey ? -1 : 1); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); endEdit(true); vp.focus({ preventScroll: true }); move(e.key === 'ArrowDown' ? 1 : -1, 0); }
  else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); vp.focus({ preventScroll: true }); }
});

// barra della formula: stessa cosa, ma scrivendo lì
bar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commit(bar.value, sel.r, sel.c); vp.focus({ preventScroll: true }); move(1, 0); }
  else if (e.key === 'Escape') { syncBar(); vp.focus({ preventScroll: true }); }
});
bar.addEventListener('change', () => commit(bar.value, sel.r, sel.c));

/* ---------------- Tastiera sulla griglia ---------------- */
vp.addEventListener('keydown', (e) => {
  if (editing) return;
  const page = Math.max(1, Math.floor(vp.clientHeight / rh) - 1);
  let handled = true;
  switch (e.key) {
    case 'ArrowUp': move(-1, 0); break;
    case 'ArrowDown': move(1, 0); break;
    case 'ArrowLeft': move(0, -1); break;
    case 'ArrowRight': move(0, 1); break;
    case 'Tab': move(0, e.shiftKey ? -1 : 1); break;
    case 'Enter': move(e.shiftKey ? -1 : 1, 0); break;
    case 'PageDown': move(page, 0); break;
    case 'PageUp': move(-page, 0); break;
    case 'Home': e.ctrlKey ? select(0, 0) : select(sel.r, 0); break;
    case 'End': e.ctrlKey ? select(MAX_ROWS - 1, MAX_COLS - 1) : select(sel.r, MAX_COLS - 1); break;
    case 'F2': startEdit(sel.r, sel.c); break;
    case 'Delete': case 'Backspace': commit('', sel.r, sel.c); syncBar(); break;
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) startEdit(sel.r, sel.c, e.key); // scrivere = sostituire
      else handled = false;
  }
  if (handled) e.preventDefault();
});

/* ---------------- Mouse / touch ---------------- */
function cellAt(e) {
  const rect = vp.getBoundingClientRect();
  if (e.clientX > rect.left + vp.clientWidth || e.clientY > rect.top + vp.clientHeight) return null; // click sulle scrollbar
  const c = Math.floor((e.clientX - rect.left + vp.scrollLeft) / cw);
  const r = Math.floor((e.clientY - rect.top + vp.scrollTop) / rh);
  return r >= 0 && c >= 0 && r < MAX_ROWS && c < MAX_COLS ? { r, c } : null;
}
vp.addEventListener('click', (e) => {
  if (e.target === ed) return;
  const p = cellAt(e); if (!p) return;
  const same = p.r === sel.r && p.c === sel.c;
  if (editing) endEdit(true);
  select(p.r, p.c, { scroll: false });
  vp.focus({ preventScroll: true });
  if (same && e.pointerType === 'touch') startEdit(p.r, p.c); // su mobile: tocca di nuovo per modificare
});
vp.addEventListener('dblclick', (e) => {
  if (e.target === ed) return;
  const p = cellAt(e); if (p) { select(p.r, p.c, { scroll: false }); startEdit(p.r, p.c); }
});

/* ---------------- Barra in alto: CSV, pulisci, installa, rete ---------------- */
$('#btnClear').addEventListener('click', () => {
  if (!confirm('Cancellare tutte le celle?')) return;
  sheet.clear(); scheduleSave(); refreshVisible(); syncBar();
});
$('#btnCsv').addEventListener('click', () => {
  let maxR = 0, maxC = 0;
  for (const k of sheet.raw.keys()) { const p = parseRef(k); maxR = Math.max(maxR, p.row); maxC = Math.max(maxC, p.col); }
  const esc = (s) => (/[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const lines = [];
  for (let r = 0; r <= maxR; r++) {
    const row = [];
    for (let c = 0; c <= maxC; c++) row.push(esc(formatValue(sheet.getValue(toKey(r, c)))));
    lines.push(row.join(';'));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'mini-foglio.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btnInstall').classList.remove('d-none'); });
$('#btnInstall').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#btnInstall').classList.add('d-none');
});
window.addEventListener('appinstalled', () => $('#btnInstall').classList.add('d-none'));
const net = () => $('#netBadge').classList.toggle('d-none', navigator.onLine);
window.addEventListener('online', net); window.addEventListener('offline', net); net();

/* ---------------- Service worker (percorso RELATIVO!) ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW non registrato', e)));
}

/* ---------------- Avvio ---------------- */
readSizes();
buildHeaders();
render();
select(0, 0, { scroll: false });
vp.focus({ preventScroll: true });

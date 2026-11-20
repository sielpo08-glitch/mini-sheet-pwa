// engine.js - parser di formule + valutazione + gestione dipendenze (nessuna dipendenza dal DOM)
import { MAX_ROWS, MAX_COLS, toKey, parseRef, inBounds } from './coordinates.js';

/* ------------------------------------------------------------------ */
/* Errori                                                              */
/* ------------------------------------------------------------------ */
export class CellError {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
export const ERR = {
  DIV0: '#DIV/0!', VALUE: '#VALORE!', REF: '#RIF!', NAME: '#NOME?',
  CIRC: '#CIRC!', SYNTAX: '#ERR!'
};
export const ERR_HELP = {
  '#DIV/0!': 'Divisione per zero',
  '#VALORE!': 'Valore di tipo non valido (es. testo in un calcolo)',
  '#RIF!': 'Riferimento a una cella fuori dalla griglia',
  '#NOME?': 'Funzione o nome sconosciuto',
  '#CIRC!': 'Riferimento circolare',
  '#ERR!': 'Errore di sintassi nella formula'
};
const err = (code) => new CellError(code);
export const isErr = (v) => v instanceof CellError;

/* ------------------------------------------------------------------ */
/* 1) TOKENIZER: stringa -> lista di token                             */
/* ------------------------------------------------------------------ */
function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }

    // numero (es. 42, 3.14, .5)
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j])) j++;
      t.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    // stringa tra virgolette ("" = virgoletta letterale)
    if (c === '"') {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= src.length) throw err(ERR.SYNTAX);
        if (src[j] === '"') {
          if (src[j + 1] === '"') { s += '"'; j += 2; continue; }
          break;
        }
        s += src[j++];
      }
      t.push({ t: 'str', v: s });
      i = j + 1; continue;
    }
    // parola: riferimento (A1, $B$2) oppure nome di funzione (SOMMA, CONTA.SE)
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.$]/.test(src[j])) j++;
      t.push({ t: 'word', v: src.slice(i, j) });
      i = j; continue;
    }
    // operatori a due caratteri, poi a uno
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') { t.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/():;,=<>'.includes(c)) { t.push({ t: 'op', v: c }); i++; continue; }
    throw err(ERR.SYNTAX);
  }
  return t;
}

/* ------------------------------------------------------------------ */
/* 2) PARSER a discesa ricorsiva: token -> AST                         */
/*    expr  := add ( (= | <> | < | > | <= | >=) add )*                  */
/*    add   := mul ( (+|-) mul )*                                      */
/*    mul   := unary ( (*|/) unary )*     <- precedenza * / sopra + -   */
/*    unary := (-|+) unary | primary                                   */
/*    primary := numero | stringa | ( expr ) | FUNZ(args) | rif | rif:rif*/
/* ------------------------------------------------------------------ */
const CMP = ['=', '<>', '<', '>', '<=', '>='];

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;

  function expr() {
    let l = add();
    while (peek() && peek().t === 'op' && CMP.includes(peek().v)) {
      const op = tokens[p++].v;
      l = { k: 'bin', op, l, r: add() };
    }
    return l;
  }
  function add() {
    let l = mul();
    while (isOp('+') || isOp('-')) { const op = tokens[p++].v; l = { k: 'bin', op, l, r: mul() }; }
    return l;
  }
  function mul() {
    let l = unary();
    while (isOp('*') || isOp('/')) { const op = tokens[p++].v; l = { k: 'bin', op, l, r: unary() }; }
    return l;
  }
  function unary() {
    if (isOp('-')) { p++; return { k: 'neg', e: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return primary();
  }
  function primary() {
    const tk = tokens[p++];
    if (!tk) throw err(ERR.SYNTAX);
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === 'str') return { k: 'str', v: tk.v };
    if (tk.t === 'op' && tk.v === '(') {
      const e = expr();
      if (!isOp(')')) throw err(ERR.SYNTAX);
      p++;
      return e;
    }
    if (tk.t === 'word') {
      if (isOp('(')) { // chiamata di funzione: NOME( arg ; arg ... )
        p++;
        const args = [];
        if (isOp(')')) p++;
        else for (;;) {
          args.push(expr());
          if (isOp(';') || isOp(',')) { p++; continue; }
          if (isOp(')')) { p++; break; }
          throw err(ERR.SYNTAX);
        }
        return { k: 'fn', name: tk.v.toUpperCase(), args };
      }
      const a = parseRef(tk.v);
      if (!a) throw err(ERR.NAME); // parola che non è funzione né cella
      if (isOp(':')) { // intervallo A1:B5
        p++;
        const t2 = tokens[p++];
        const b = t2 && t2.t === 'word' ? parseRef(t2.v) : null;
        if (!b) throw err(ERR.SYNTAX);
        return { k: 'range', r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row),
                 c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col) };
      }
      return { k: 'ref', row: a.row, col: a.col };
    }
    throw err(ERR.SYNTAX);
  }

  const ast = expr();
  if (p < tokens.length) throw err(ERR.SYNTAX); // token avanzati = formula malformata
  return ast;
}

/** Compila "SOMMA(A1:A3)+B1" -> {ast, cells:Set, ranges:[]} oppure {error} */
function compile(src) {
  const f = { ast: null, error: null, cells: new Set(), ranges: [] };
  try {
    f.ast = parse(tokenize(src));
    // raccolta dei precedenti (celle e intervalli da cui la formula dipende)
    (function walk(n) {
      if (n.k === 'ref') { if (inBounds(n.row, n.col)) f.cells.add(toKey(n.row, n.col)); }
      else if (n.k === 'range') f.ranges.push({ r1: n.r1, r2: n.r2, c1: n.c1, c2: n.c2 });
      else if (n.k === 'bin') { walk(n.l); walk(n.r); }
      else if (n.k === 'neg') walk(n.e);
      else if (n.k === 'fn') n.args.forEach(walk);
    })(f.ast);
  } catch (e) {
    if (e instanceof CellError) f.error = e; else throw e;
  }
  return f;
}

/* ------------------------------------------------------------------ */
/* 3) Conversioni e funzioni                                           */
/* ------------------------------------------------------------------ */
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) throw v;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
  throw err(ERR.VALUE);
}
function toBool(v) {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  throw err(ERR.VALUE);
}
function compare(a, b, op) {
  if (typeof a === 'boolean') a = +a;
  if (typeof b === 'boolean') b = +b;
  if (a === null) a = typeof b === 'string' ? '' : 0;
  if (b === null) b = typeof a === 'string' ? '' : 0;
  let c;
  if (typeof a === typeof b) {
    if (typeof a === 'string') { a = a.toLowerCase(); b = b.toLowerCase(); }
    c = a < b ? -1 : a > b ? 1 : 0;
  } else c = typeof a === 'number' ? -1 : 1; // numeri < testo
  return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
}

const isRange = (a) => a && a.range === true;

/** numeri contenuti negli argomenti (negli intervalli conta solo chi è numero) */
function nums(args) {
  const out = [];
  for (const a of args) {
    if (isRange(a)) {
      for (const v of a.values) { if (isErr(v)) throw v; if (typeof v === 'number') out.push(v); }
    } else out.push(toNum(a));
  }
  return out;
}

/** Crea il test per criteri tipo ">5", "<=3", "<>x", "testo", 7 */
function makeMatcher(crit) {
  const s = crit === null ? '' : String(crit);
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(s);
  const op = m[1] || '=';
  const rest = m[2];
  const rn = rest.trim() !== '' && isFinite(Number(rest)) ? Number(rest) : null;
  const cmp = (x, y) => compare(x, y, op);
  return (v) => {
    if (isErr(v)) return false;
    if (rn !== null) { // criterio numerico
      if (typeof v === 'number') return cmp(v, rn);
      return op === '<>';
    }
    const txt = v === null ? '' : String(v); // criterio testuale (non distingue maiuscole)
    return cmp(txt.toLowerCase(), rest.toLowerCase());
  };
}

/** SOMMA.SE / CONTA.SE / MEDIA.SE: mode = 'sum' | 'count' | 'avg' */
function conditional(args, mode) {
  const maxLen = mode === 'count' ? 2 : 3;
  if (args.length < 2 || args.length > maxLen || !isRange(args[0]) || isRange(args[1])) throw err(ERR.VALUE);
  const test = makeMatcher(args[1]);
  const crit = args[0].values;
  let target = crit;
  if (mode !== 'count' && args[2] !== undefined) {
    if (!isRange(args[2])) throw err(ERR.VALUE);
    target = args[2].values; // stessa forma: stesso indice = stessa posizione relativa
  }
  let sum = 0, cnt = 0;
  crit.forEach((v, i) => {
    if (!test(v)) return;
    if (mode === 'count') { cnt++; return; }
    const t = target[i];
    if (isErr(t)) throw t;
    if (typeof t === 'number') { sum += t; cnt++; }
  });
  if (mode === 'sum') return sum;
  if (mode === 'count') return cnt;
  if (cnt === 0) throw err(ERR.DIV0);
  return sum / cnt;
}

const FUNCS = {
  'SOMMA': (a) => nums(a).reduce((x, y) => x + y, 0),
  'MEDIA': (a) => { const n = nums(a); if (!n.length) throw err(ERR.DIV0); return n.reduce((x, y) => x + y, 0) / n.length; },
  'CONTA': (a) => {
    let n = 0;
    for (const x of a) {
      if (isRange(x)) { for (const v of x.values) if (typeof v === 'number') n++; }
      else { try { toNum(x); n++; } catch (e) { if (!isErr(e)) throw e; } }
    }
    return n;
  },
  'CONTA.VALORI': (a) => {
    let n = 0;
    for (const x of a) {
      if (isRange(x)) { for (const v of x.values) if (v !== null && v !== '') n++; }
      else if (x !== null) n++;
    }
    return n;
  },
  'SOMMA.SE': (a) => conditional(a, 'sum'),
  'CONTA.SE': (a) => conditional(a, 'count'),
  'MEDIA.SE': (a) => conditional(a, 'avg'),
  'MAX': (a) => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
  'MIN': (a) => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
  // --- extra (bonus) ---
  'CONCAT': (a) => {
    let s = '';
    for (const x of a) {
      const list = isRange(x) ? x.values : [x];
      for (const v of list) { if (isErr(v)) throw v; s += v === null ? '' : typeof v === 'boolean' ? (v ? 'VERO' : 'FALSO') : String(v); }
    }
    return s;
  },
  'ARROTONDA': (a) => {
    if (a.length < 1 || a.length > 2) throw err(ERR.VALUE);
    const x = toNum(a[0]), d = a.length === 2 ? toNum(a[1]) : 0, f = 10 ** d;
    return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f; // mezzi arrotondati "lontano da zero"
  },
  'ABS': (a) => { if (a.length !== 1) throw err(ERR.VALUE); return Math.abs(toNum(a[0])); }
  // 'SE' è gestita a parte in _eval (valuta solo il ramo scelto)
};

/** Valore -> testo da mostrare nella cella */
export function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (isErr(v)) return v.code;
  if (typeof v === 'boolean') return v ? 'VERO' : 'FALSO';
  if (typeof v === 'number') return isFinite(v) ? String(Number(v.toPrecision(12))) : ERR.VALUE;
  return String(v);
}

/** Testo digitato (non formula) -> numero oppure stringa */
function parseLiteral(raw) {
  const t = raw.trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return Number(t);
  return raw;
}

/* ------------------------------------------------------------------ */
/* 4) Sheet: dati + cache + grafo delle dipendenze                     */
/* ------------------------------------------------------------------ */
export class Sheet {
  constructor() {
    this.raw = new Map();       // chiave "A1" -> testo grezzo digitato
    this.formulas = new Map();  // chiave -> formula compilata (solo celle con "=")
    this.cache = new Map();     // chiave -> valore calcolato (invalidata solo per le celle sporche)
    this.cellDeps = new Map();  // cella -> Set di formule che la citano direttamente
    this.rangeDeps = new Map(); // formula -> intervalli citati (controllo di contenimento)
    this.evaluating = new Set();// celle in calcolo: serve a scoprire i cicli
  }

  getRaw(key) { return this.raw.get(key) ?? ''; }

  /** Imposta il contenuto di una cella; ritorna le celle da ricalcolare (lei + dipendenti, anche indiretti) */
  setRaw(key, text) {
    this._put(key, text);
    const dirty = this._dirtyFrom(key);
    for (const k of dirty) this.cache.delete(k); // invalida SOLO queste
    return dirty;
  }

  /** Ricalcola (e mette in cache) le celle indicate */
  recalc(keys) { for (const k of keys) this.getValue(k); }

  /** Caricamento in blocco (es. da localStorage) */
  load(obj) {
    for (const [k, v] of Object.entries(obj)) this._put(k, v);
    this.cache.clear();
  }
  toJSON() { return Object.fromEntries(this.raw); }
  clear() {
    this.raw.clear(); this.formulas.clear(); this.cache.clear();
    this.cellDeps.clear(); this.rangeDeps.clear();
  }

  _put(key, text) {
    this._unregister(key);
    const raw = text == null ? '' : String(text);
    if (raw.trim() === '') { this.raw.delete(key); this.formulas.delete(key); return; }
    this.raw.set(key, raw);
    if (raw[0] === '=') {
      const f = compile(raw.slice(1));
      this.formulas.set(key, f);
      for (const c of f.cells) {
        if (!this.cellDeps.has(c)) this.cellDeps.set(c, new Set());
        this.cellDeps.get(c).add(key);
      }
      if (f.ranges.length) this.rangeDeps.set(key, f.ranges);
    } else this.formulas.delete(key);
  }
  _unregister(key) {
    const old = this.formulas.get(key);
    if (!old) return;
    for (const c of old.cells) { const s = this.cellDeps.get(c); if (s) s.delete(key); }
    this.rangeDeps.delete(key);
  }

  /** Visita il grafo al contrario: chi dipende (direttamente o no) da `key`? */
  _dirtyFrom(key) {
    const seen = new Set([key]);
    const stack = [key];
    while (stack.length) {
      const k = stack.pop();
      const direct = this.cellDeps.get(k);
      if (direct) for (const f of direct) if (!seen.has(f)) { seen.add(f); stack.push(f); }
      const ref = parseRef(k);
      for (const [f, ranges] of this.rangeDeps) {
        if (seen.has(f)) continue;
        if (ranges.some((g) => ref.row >= g.r1 && ref.row <= g.r2 && ref.col >= g.c1 && ref.col <= g.c2)) {
          seen.add(f); stack.push(f);
        }
      }
    }
    return [...seen];
  }

  /** Valore di una cella (null = vuota). Usa la cache; rileva i cicli. */
  getValue(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const raw = this.raw.get(key);
    if (raw === undefined) return null;
    let v;
    const f = this.formulas.get(key);
    if (!f) v = parseLiteral(raw);
    else {
      // Se la cella è già "in calcolo" e qualcuno la richiede di nuovo: ciclo!
      if (this.evaluating.has(key)) return err(ERR.CIRC);
      this.evaluating.add(key);
      try {
        if (f.error) v = f.error;
        else {
          v = this._eval(f.ast, key);
          if (v === null) v = 0;          // =A1 con A1 vuota -> 0
          if (isRange(v)) v = err(ERR.VALUE);
        }
      } catch (e) {
        if (isErr(e)) v = e;
        else if (e instanceof RangeError) v = err(ERR.CIRC); // catena troppo profonda
        else throw e;
      } finally { this.evaluating.delete(key); }
    }
    this.cache.set(key, v);
    return v;
  }

  _range(n, self) {
    if (!inBounds(n.r1, n.c1) || !inBounds(n.r2, n.c2)) throw err(ERR.REF);
    const values = [];
    for (let r = n.r1; r <= n.r2; r++) {
      for (let c = n.c1; c <= n.c2; c++) {
        const k = toKey(r, c);
        // la cella che contiene la formula, se cade nel proprio intervallo, viene ignorata
        values.push(k === self ? null : this.getValue(k));
      }
    }
    return { range: true, values };
  }

  _eval(n, self) {
    switch (n.k) {
      case 'num': case 'str': return n.v;
      case 'ref': {
        if (!inBounds(n.row, n.col)) throw err(ERR.REF);
        const v = this.getValue(toKey(n.row, n.col));
        if (isErr(v)) throw v; // gli errori si propagano
        return v;
      }
      case 'range': throw err(ERR.VALUE); // un intervallo da solo non è un valore
      case 'neg': return -toNum(this._eval(n.e, self));
      case 'bin': {
        const a = this._eval(n.l, self), b = this._eval(n.r, self);
        if (CMP.includes(n.op)) return compare(a, b, n.op);
        const x = toNum(a), y = toNum(b);
        switch (n.op) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          case '/': if (y === 0) throw err(ERR.DIV0); return x / y;
        }
        throw err(ERR.SYNTAX);
      }
      case 'fn': {
        if (n.name === 'SE') { // lazy: valuta solo il ramo scelto
          if (n.args.length < 2 || n.args.length > 3) throw err(ERR.VALUE);
          const cond = toBool(this._eval(n.args[0], self));
          const branch = cond ? n.args[1] : n.args[2];
          return branch ? this._eval(branch, self) : false;
        }
        const fn = FUNCS[n.name];
        if (!fn) throw err(ERR.NAME);
        const args = n.args.map((a) => (a.k === 'range' ? this._range(a, self) : this._eval(a, self)));
        return fn(args);
      }
    }
    throw err(ERR.SYNTAX);
  }
}

// coordinates.js - conversione tra notazione A1 e indici (0-based)
export const MAX_ROWS = 100;
export const MAX_COLS = 100; // A..CV

const NAMES = []; // cache dei nomi colonna: 0 -> "A", 26 -> "AA", 99 -> "CV"

/** indice colonna (0-based) -> lettere */
export function colName(i) {
  if (NAMES[i]) return NAMES[i];
  let n = i + 1, s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return (NAMES[i] = s);
}

/** lettere -> indice colonna (0-based) */
export function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "B3" / "$B$3" -> {row:2, col:1}; null se non è un riferimento valido */
export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) return null;
  return { col: colIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

/** (riga, colonna) 0-based -> "B3" */
export const toKey = (row, col) => colName(col) + (row + 1);

export const inBounds = (row, col) => row >= 0 && col >= 0 && row < MAX_ROWS && col < MAX_COLS;

// Test automatici del motore: node tests/engine.test.mjs
import { Sheet, formatValue } from '../js/engine.js';

let ok = 0, ko = 0;
function check(name, got, want) {
  const pass = got === want;
  pass ? ok++ : ko++;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}  ->  ${got}${pass ? '' : `  (atteso ${want})`}`);
}
const set = (s, k, v) => s.recalc(s.setRaw(k, v));
const val = (s, k) => formatValue(s.getValue(k));

// 1) somma
let s = new Sheet();
set(s, 'A1', '5'); set(s, 'A2', '10'); set(s, 'A3', '=SOMMA(A1:A2)');
check('T1 A3 =SOMMA(A1:A2)', val(s, 'A3'), '15');
// 2) divisione per zero
set(s, 'B1', '0'); set(s, 'B2', '=A1/B1');
check('T2 B2 =A1/B1', val(s, 'B2'), '#DIV/0!');
// 3) riferimento circolare
set(s, 'C1', '=C1');
check('T3 C1 =C1', val(s, 'C1'), '#CIRC!');
set(s, 'F1', '=G1'); set(s, 'G1', '=F1');
check('T3b catena F1<->G1', val(s, 'F1') + ' ' + val(s, 'G1'), '#CIRC! #CIRC!');
set(s, 'G1', '7');
check('T3c rottura del ciclo ricalcola F1', val(s, 'F1'), '7');
// 4) CONTA.SE su valori misti
s = new Sheet();
['3', '8', 'ciao', '', '6', '5', '12'].forEach((v, i) => set(s, 'A' + (i + 1), v));
set(s, 'D1', '=CONTA.SE(A1:A10;">5")');
check('T4 CONTA.SE >5', val(s, 'D1'), '3');
set(s, 'D2', '=SOMMA.SE(A1:A10;">5")'); check('SOMMA.SE >5', val(s, 'D2'), '26');
set(s, 'D3', '=MEDIA.SE(A1:A10;">5")'); check('MEDIA.SE >5', val(s, 'D3'), String(Number((26 / 3).toPrecision(12))));
set(s, 'D4', '=CONTA.SE(A1:A10;"ciao")'); check('CONTA.SE testo', val(s, 'D4'), '1');
set(s, 'D5', '=CONTA(A1:A10)'); check('CONTA', val(s, 'D5'), '5');
set(s, 'D6', '=CONTA.VALORI(A1:A10)'); check('CONTA.VALORI', val(s, 'D6'), '6');
set(s, 'D7', '=MAX(A1:A10)'); check('MAX', val(s, 'D7'), '12');
set(s, 'D8', '=MIN(A1:A10)'); check('MIN', val(s, 'D8'), '3');
set(s, 'D9', '=MEDIA(A1:A10)'); check('MEDIA', val(s, 'D9'), '6.8');
set(s, 'B1', '1'); set(s, 'B2', '2'); set(s, 'B3', '3');
set(s, 'D10', '=SOMMA.SE(A1:A3;">5";B1:B3)'); check('SOMMA.SE con intervallo somma', val(s, 'D10'), '2');
// 5) SOMMA su griglia vuota
s = new Sheet();
set(s, 'E1', '=SOMMA(A1:CV100)');
check('T5 E1 =SOMMA(A1:CV100) griglia vuota', val(s, 'E1'), '0');
// operatori / parentesi / errori
set(s, 'H1', '=2+3*4'); check('precedenza', val(s, 'H1'), '14');
set(s, 'H2', '=(2+3)*4'); check('parentesi', val(s, 'H2'), '20');
set(s, 'H3', '=-(1+2)*3'); check('meno unario', val(s, 'H3'), '-9');
set(s, 'H4', '=FOO(1)'); check('#NOME?', val(s, 'H4'), '#NOME?');
set(s, 'H5', '=ZZ1'); check('#RIF? fuori griglia', val(s, 'H5'), '#RIF!');
set(s, 'H6', '=SOMMA(A1:CW5)'); check('#RIF! intervallo', val(s, 'H6'), '#RIF!');
set(s, 'H7', 'ciao'); set(s, 'H8', '=H7+1'); check('#VALORE! testo+1', val(s, 'H8'), '#VALORE!');
set(s, 'H9', '=1+'); check('sintassi', val(s, 'H9'), '#ERR!');
set(s, 'I1', '=SE(2>1;"si";"no")'); check('SE', val(s, 'I1'), 'si');
set(s, 'I2', '=CONCAT("a";H1;"b")'); check('CONCAT', val(s, 'I2'), 'a14b');
set(s, 'I3', '=ARROTONDA(2,5;0)'.replace(',', '.')); check('ARROTONDA', val(s, 'I3'), '3');
set(s, 'J1', '=J2'); set(s, 'J2', '=A1'); // riferimento a cella vuota
check('ref a vuota = 0', val(s, 'J1'), '0');
set(s, 'K1', '=SOMMA(K2:K3)'); set(s, 'K2', '4'); set(s, 'K3', '=K1');
check('ciclo via intervallo', val(s, 'K1'), '#CIRC!');

// 7) prestazioni: 100 formule che dipendono da A1 (+ griglia 100x100 piena)
s = new Sheet();
for (let r = 1; r <= 100; r++) for (let c = 0; c < 100; c++) {
  const col = c < 26 ? String.fromCharCode(65 + c) : String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + c % 26);
  s.setRaw(col + r, String(r + c));
}
set(s, 'A1', '1');
for (let r = 1; r <= 100; r++) set(s, 'CX' === '' ? '' : 'B' + r, '=A1*2+SOMMA(A1:A100)'); // 100 dipendenti da A1
const t0 = performance.now();
set(s, 'A1', '42');
const ms = performance.now() - t0;
check(`T7 100 dipendenze ricalcolate in ${ms.toFixed(1)} ms (<300)`, ms < 300, true);
check('T7 valore corretto', val(s, 'B50'), String(84 + 42 + [...Array(99).keys()].reduce((a, i) => a + (i + 2), 0)));

console.log(`\n${ok} ok, ${ko} falliti`);
process.exit(ko ? 1 : 0);

# Mini-Foglio di Calcolo (PWA)

## 🔗 Sito pubblicato: **INSERISCI QUI L'URL** (GitHub Pages / Vercel)

Foglio di calcolo semplificato 100×100 (A1:CV100), con motore di formule scritto da zero,
installabile come app e funzionante offline. HTML + CSS + JavaScript vanilla, Bootstrap 5 (CSS, in locale in `vendor/`).

## Avvio in locale
Serve un server (il service worker non funziona da `file://`):
```bash
python3 -m http.server 8080      # poi apri http://localhost:8080
npm test                          # test automatici del motore (Node)
```

## Deploy
**Piattaforma scelta:** _(GitHub Pages / Vercel — scrivi perché)_

GitHub Pages: `git init && git add . && git commit -m "Prima versione" && git branch -M main`,
`git remote add origin https://github.com/TUO-USERNAME/mini-sheet-pwa.git && git push -u origin main`,
poi *Settings → Pages → Deploy from a branch → main / (root)*.
Vercel: *Add New → Project* dal repo, Framework Preset **Other**, build command vuoto, output directory `.`.
Tutti i percorsi sono relativi (`./sw.js`, `./js/app.js`, `start_url: "./"`, `scope: "./"`).
Se modifichi un file, incrementa `CACHE_VERSION` in `sw.js`.

## Funzioni implementate
- Griglia editabile 100×100, intestazioni A…CV / 1…100, barra della formula con nome cella
- Numeri, testo, formule con `=`; operatori `+ - * /`, parentesi, meno unario, confronti
- `SOMMA`, `MEDIA`, `CONTA`, `CONTA.VALORI`, `SOMMA.SE`, `CONTA.SE`, `MEDIA.SE`, `MAX`, `MIN`
- Extra: `SE`, `CONCAT`, `ARROTONDA`, `ABS`, salvataggio in localStorage, esportazione CSV
- Errori: `#DIV/0!`, `#VALORE!`, `#RIF!`, `#NOME?`, `#CIRC!` (riferimento circolare), `#ERR!` (sintassi)
- Tastiera: frecce, Tab / Shift+Tab, Invio / Shift+Invio, PagSu/PagGiù, Home/Fine, F2, Canc, digitare per sostituire
- Mobile: tocca per selezionare, tocca di nuovo per modificare (oppure usa la barra della formula)

## Virtualizzazione
Nel DOM ci sono solo le celle visibili (≈ 30×15 + 2 di margine per lato), mai 10.000. Un contenitore scrollabile
ha la dimensione totale della griglia (`#sizer`); a ogni scroll (max 1 volta per frame con `requestAnimationFrame`)
si tolgono le celle uscite e si creano quelle entrate, posizionate in `absolute`. Le intestazioni sono spostate con `transform`.

## Motore e dipendenze
Tokenizer → parser a discesa ricorsiva (AST) → valutazione con cache. Ogni formula registra da cosa dipende (celle e intervalli).
Quando una cella cambia si visita il grafo al contrario e si invalidano **solo** lei e i suoi dipendenti (anche indiretti);
le altre celle restano in cache. I cicli si rilevano con l'insieme delle celle "in calcolo".
Nota: una formula che cade dentro il proprio intervallo (es. `E1 = SOMMA(A1:CV100)`) ignora se stessa, per rispettare il test 5.

## Casi di test
| # | Caso | Esito |
|---|------|-------|
| 1 | A3 `=SOMMA(A1:A2)` → 15 | ✅ automatico |
| 2 | `=A1/B1` con B1=0 → `#DIV/0!` | ✅ automatico |
| 3 | `C1 = =C1` → `#CIRC!` | ✅ automatico |
| 4 | `CONTA.SE(A1:A10;">5")` valori misti | ✅ automatico |
| 5 | `SOMMA(A1:CV100)` griglia vuota → 0 | ✅ automatico |
| 6 | Scorrimento riga 1→100 e ritorno | ⬜ da provare nel browser |
| 7 | 100 dipendenze < 300 ms | ✅ automatico (~3 ms nel test Node) |
| 8 | Offline: ricarica e funziona | ⬜ da provare (DevTools → Network → Offline) |
| 9 | URL pubblico in incognito, installabile, offline | ⬜ da provare dopo il deploy |
| 10 | Nessun 404 in console sull'URL pubblico | ⬜ da provare dopo il deploy |

## Difficoltà incontrate e come risolte
_(da compilare con la vostra esperienza reale)_

## Domande di riflessione
_(da rispondere voi, a coppie, con onestà: cosa avete scritto voi, cosa ha generato l'AI, cosa avete corretto)_
1. Quale parte del codice hai scritto tu e quale è stata generata dall'AI? Come hai verificato la correttezza?
2. Quali prompt sono stati più efficaci? Perché?
3. Cosa ha fatto l'AI che hai dovuto correggere? Perché?
4. Quale strategia di virtualizzazione hai scelto e perché? Quali alternative hai valutato?
5. Come hai gestito le dipendenze tra celle per evitare ricalcoli inutili su 10.000 celle?
6. Quale piattaforma hai scelto per il deploy e perché? Quali problemi hai incontrato?
7. Come hai verificato che la PWA funzioni dall'URL pubblico e non solo in locale?
8. Cosa cambieresti se dovessi rifare la prova?

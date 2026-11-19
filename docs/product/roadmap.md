# Scia — roadmap

Lo stato è quello vero: una voce è «fatta» solo se è verificata nell'app reale.

## M0 — Fondamenta (fatto)

- Monorepo, strumenti, hook, test su quattro livelli.
- Repository su GitHub con GitFlow, controlli sulle PR, versioni e note di rilascio automatiche (semantic-release). **Gli installer allegati alle release stabili non sono ancora stati prodotti dalla CI.**
- Motore: download su più connessioni con segmentazione dinamica, pausa e ripresa, coda, tentativi dopo un'interruzione, nomi sicuri e mai sovrascritti, stato salvato su disco.
- App Electron: finestra con barra del titolo propria, supervisione del motore, chiusura ordinata, ripresa al riavvio.
- Interfaccia: aggiunta per incolla, elenco con barra dei segmenti, filtri, impostazioni di base.
- Estensione (Chromium): menu «Scarica con Scia», media rilevati nella pagina, passaggio opzionale dei download del browser. **Scritta e coperta da test nella sua logica; non ancora provata in un browser reale.**

## M1 — Uso quotidiano

- Icona nell'area di notifica: chiudere la finestra non ferma i download.
- Scelta della cartella, predefinita e per singolo download.
- Limite di velocità, globale e per download.
- Notifica a download finito; «Apri» e «Mostra nella cartella» già presenti.
- Controllo degli appunti (facoltativo): un link copiato viene proposto.
- Icona e identità dell'app; installer per Windows (NSIS) e Linux (AppImage, deb) provati su macchine pulite.
- Aggiornamenti automatici.
- Suite E2E con Playwright sull'app reale.
- Da misurare: l'attesa dovuta al riempimento di zeri su NTFS per i file molto grandi (ADR 0001).

## M2 — Estensione completa

- Prova in Chrome, Edge, Brave; versione per Firefox.
- Pubblicazione negli store.
- Download dietro accesso: invio dei cookie della sessione, scelta esplicita e per sito.
- Flussi adattivi (HLS, DASH): riconoscimento, scelta della qualità, ricomposizione. Solo flussi non protetti.
- Porta alternativa e ricerca automatica dell'app se la 47821 è occupata.

## M3 — Servizi debrid

- AllDebrid: chiave API custodita dal sistema operativo, sblocco dei link degli hoster, rinnovo di un link scaduto durante un download lungo.
- Magnet tramite AllDebrid.
- Riconoscimento dei link sbloccabili al momento dell'aggiunta, con l'elenco dei file prima di scaricare.
- Un secondo servizio, per provare che l'astrazione regge.

## M4 — Organizzazione

- Categorie e regole (cartella per tipo o per sito).
- Pianificazione oraria.
- Verifica dell'integrità (checksum) ed estrazione degli archivi.
- Proxy.
- Cronologia con ricerca: è il momento di passare da `state.json` a un database.

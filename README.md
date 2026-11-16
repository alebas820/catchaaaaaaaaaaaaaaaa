# Catcha

Applicazione privata per cercare attività locali da fonti cartografiche, gestire una lista personale di contatti e preparare proposte web. Richiede Node.js 22+ e non usa dipendenze esterne. Render usa la versione fissata in `.node-version`.

## Avvio

Le credenziali sono configurate nelle variabili d'ambiente del tuo account Windows, non nei file del progetto. Da PowerShell, nella cartella del progetto, caricale e avvia il server:

```powershell
$env:CATCHA_ADMIN_USER = [Environment]::GetEnvironmentVariable("CATCHA_ADMIN_USER", "User")
$env:CATCHA_ADMIN_PASSWORD = [Environment]::GetEnvironmentVariable("CATCHA_ADMIN_PASSWORD", "User")
$env:GEMINI_API_KEY = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "User")
if (-not $env:CATCHA_ADMIN_USER -or -not $env:CATCHA_ADMIN_PASSWORD) { throw "Configura le credenziali Catcha nell'ambiente utente Windows." }
$env:CATCHA_SESSION_SECRET = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
node .\server.js
```

Apri `http://localhost:3000`: la pagina di login è l'ingresso obbligatorio e anche gli URL diretti alle pagine e alle risorse dell'app richiedono una sessione valida. Dopo l'accesso puoi uscire dal pulsante in alto. Le credenziali sono solo quelle configurate dall'amministratore; non esiste una registrazione. Per autorizzare un'altra persona, condividi le credenziali attraverso un canale sicuro. La sessione firmata dura otto ore. In produzione imposta `NODE_ENV=production` per abilitare l'attributo `Secure` e usa HTTPS.

La schermata di accesso rimanda al server Discord ufficiale per acquistare l'accesso. Dopo il login, l'icona utente nella barra superiore mostra lo username della sessione.

## Pubblicazione su Render

Catcha richiede il server Node per proteggere le pagine e gestire login, logout, ricerca e funzioni AI. Non pubblicarlo come sito statico o con Netlify Drop: in quel caso `server.js` non viene avviato e l'autenticazione non protegge l'app. Il progetto include `render.yaml` per creare un Web Service Node.js su Render, nella regione di Francoforte, usando il piano gratuito. Il servizio usa `npm ci` per la build, `npm start` per l'avvio e `/healthz` per il controllo di salute.

1. Crea un repository GitHub **privato** e carica il progetto. Non aggiungere chiavi API, password o file `.env`.
2. In Render scegli **New > Blueprint**, collega il repository e avvia il deploy di `render.yaml`.
3. Inserisci i valori richiesti dal Blueprint: `CATCHA_ADMIN_USER`, una nuova `CATCHA_ADMIN_PASSWORD` unica di almeno 16 caratteri, `CATCHA_SESSION_SECRET` casuale di almeno 32 caratteri e `GEMINI_API_KEY`. Puoi generare il segreto di sessione in locale con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` e incollarlo nei segreti Render. Il valore `NODE_ENV=production` è già dichiarato. Non riutilizzare password già condivise.
4. Attendi che il controllo `/healthz` risulti valido, poi apri l'indirizzo HTTPS `*.onrender.com` assegnato al servizio.

Il piano gratuito Render sospende il servizio dopo 15 minuti senza traffico e la riattivazione può richiedere circa un minuto; non offre un filesystem persistente e Render lo consiglia per test e progetti personali, non per produzione. Prima di un lancio commerciale, scegli un piano adatto in Render. Le sessioni in memoria vengono perse a ogni riavvio o sospensione. La lista delle attività resta invece nel browser di ciascun utente. Anche Gemini e i servizi pubblici OpenStreetMap hanno limiti e condizioni d'uso separati dall'hosting.

Prima di vendere accessi a più clienti, considera che Catcha usa un solo username e password configurati sul server, non account individuali; liste e attività salvate non sono condivise tra utenti. Un lancio commerciale richiede di definire gestione degli account, privacy e assistenza.

La navigazione separa l'esplorazione, la lista «Da contattare / Per dopo» e il laboratorio degli strumenti. Le selezioni e i dettagli delle attività salvate restano nel local storage del browser, su questo dispositivo; non vengono sincronizzati con il server.

## Configurare Gemini

Per abilitare la proposta personalizzata, il brief per il sito e la stima orientativa, crea una chiave in [Google AI Studio](https://aistudio.google.com/apikey). Salvala come variabile d'ambiente utente Windows chiamata `GEMINI_API_KEY` (da **Variabili d'ambiente per l'account**); non inserirla nei file del progetto, nel browser o in chat. Chiudi e riapri PowerShell/VS Code dopo averla salvata, poi avvia il server con il comando sopra. La chiave viene letta solo dal server e non viene inviata al browser. Se non è configurata, le funzioni AI mostrano una spiegazione e la ricerca delle attività continua a funzionare.

Catcha usa Gemini 3.8 Flash con ragionamento a bassa latenza; se il modello è sovraccarico o scade, riprova automaticamente con Gemini 3.5 Flash-Lite. Invia a Google solo i dati descrittivi dell'attività, il contesto facoltativo e, per la stima, la descrizione testuale del progetto quando premi il relativo pulsante. Non invia i recapiti OSM e non visita URL incollati. Non includere dati riservati. Limiti, disponibilità e possibili costi dipendono dal progetto Google configurato. La stima è indicativa, non un preventivo professionale.

## Fonti dati e limiti operativi

- Non ci sono attività precaricate o conteggi inventati: i risultati appaiono solo dopo una ricerca, tramite l'API pubblica Photon basata sui dati OpenStreetMap. Per città e regioni il server trova prima la località con Nominatim. Le ricerche per città e GPS coprono un raggio di 15 km; quelle per regione usano il confine rettangolare restituito da Nominatim, poi filtrano i risultati per regione quando Photon fornisce questo dato. Photon restituisce al massimo 50 attività, mostrate in pagine da 12 risultati. Catcha non registra la posizione o i termini cercati. I dati cartografici possono essere incompleti o non aggiornati in tempo reale.
- «Sito da verificare» è intenzionale: Photon non conferma se un'attività abbia un sito web. Per i recapiti, Catcha arricchisce i risultati con una richiesta raggruppata a Nominatim per i dati OSM; email, telefoni e siti vengono mostrati solo se la scheda li pubblica. Verifica sempre i canali ufficiali. Catcha non mostra conteggi di interesse di altri utenti; le liste personali restano nel browser su questo dispositivo e non sono condivise.
- Le foto non sono fornite dalla ricerca Photon: se una scheda OSM contiene un riferimento riutilizzabile a Wikimedia Commons, Catcha può mostrare la relativa immagine. Le immagini di Google Maps non vengono copiate.
- OpenStreetMap è una mappa collaborativa, non un registro in tempo reale né una fonte completa. La geocodifica usa il servizio pubblico Nominatim e la ricerca attività il servizio pubblico Photon; entrambi possono avere limiti di disponibilità e copertura.
- Le funzioni di proposta, brief e stima usano Gemini lato server se è configurata `GEMINI_API_KEY`. Il brief è generato per l'attività selezionata; l'utente può copiarlo e aprire la piattaforma di creazione siti scelta. L'AI può sbagliare: verifica i contenuti, le ipotesi e la fascia di prezzo prima di usarli.
- La ricevuta è un fac-simile non fiscale, da verificare prima di qualsiasi utilizzo.
- Le credenziali sono configurate sul server tramite variabili d'ambiente. Non inserire password nel codice o in file pubblicati.

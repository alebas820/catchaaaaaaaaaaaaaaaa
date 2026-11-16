# Catcha

Applicazione privata per cercare attività locali da fonti cartografiche, gestire una lista personale di contatti e preparare proposte web. Richiede Node.js 22+ e non usa dipendenze esterne. Render usa la versione fissata in `.node-version`.

## Avvio

Le credenziali sono configurate nelle variabili d'ambiente, non nel codice. Imposta `CATCHA_ADMIN_USER` e `CATCHA_ADMIN_PASSWORD` per l'amministratore. Per creare account iniziali via configurazione puoi anche impostare `CATCHA_USERS_JSON`, un array JSON di oggetti `username` / `password`; gli account creati dalla pagina admin vengono invece salvati con password hashate sotto `CATCHA_DATA_DIR`. In locale carica le variabili dall'ambiente Windows:

```powershell
$env:CATCHA_ADMIN_USER = [Environment]::GetEnvironmentVariable("CATCHA_ADMIN_USER", "User")
$env:CATCHA_ADMIN_PASSWORD = [Environment]::GetEnvironmentVariable("CATCHA_ADMIN_PASSWORD", "User")
$env:CATCHA_USERS_JSON = [Environment]::GetEnvironmentVariable("CATCHA_USERS_JSON", "User")
$env:GEMINI_API_KEY = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "User")
if (-not $env:CATCHA_ADMIN_USER -or -not $env:CATCHA_ADMIN_PASSWORD) { throw "Configura le credenziali admin nell'ambiente utente Windows." }
$env:CATCHA_SESSION_SECRET = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
node .\server.js
```

Il JSON opzionale ha forma `[{"username":"utente1","password":"..."}]`. Inserisci le password reali solo nel gestore di variabili/segreti del sistema, mai nei file del repository o nella cronologia dei comandi. L'amministratore usa lo stesso login principale; dopo aver effettuato l'accesso, il link **Admin** nell'intestazione apre `/admin` ed è visibile solo al ruolo amministratore. Da lì può eliminare gli account creati nel pannello: l'operazione revoca le sessioni e cancella anche `progress` e `savedBusinesses`. Gli account dichiarati nelle variabili d'ambiente vanno rimossi dalla configurazione del server. Le password create dall'amministratore devono essere di almeno 12 caratteri in locale e 16 in produzione.

Apri `http://localhost:3000`: la pagina di login e gli URL diretti richiedono una sessione valida, associata allo username autenticato. Dopo l'accesso puoi uscire dal pulsante in alto. Non esiste una registrazione pubblica. La sessione firmata dura otto ore e risiede in memoria, quindi dopo un riavvio è necessario accedere di nuovo. In produzione imposta `NODE_ENV=production` per abilitare l'attributo cookie `Secure` e usa HTTPS; ogni password deve essere unica e lunga almeno 16 caratteri.

La schermata di accesso rimanda al server Discord ufficiale per acquistare l'accesso. Dopo il login, l'icona utente nella barra superiore mostra lo username della sessione.

## Pubblicazione su Render

Catcha richiede il server Node per proteggere le pagine e gestire login, logout, ricerca e funzioni AI. Non pubblicarlo come sito statico o con Netlify Drop: in quel caso `server.js` non viene avviato e l'autenticazione non protegge l'app. Il progetto include `render.yaml` per creare un Web Service Node.js su Render, nella regione di Francoforte, usando il piano gratuito. Il servizio usa `npm ci` per la build, `npm start` per l'avvio e `/healthz` per il controllo di salute.

1. Crea un repository GitHub **privato** e carica il progetto. Non aggiungere chiavi API, password o file `.env`.
2. In Render scegli **New > Blueprint**, collega il repository e avvia il deploy di `render.yaml`.
3. Inserisci `CATCHA_ADMIN_USER`, una password admin unica di almeno 16 caratteri, `CATCHA_SESSION_SECRET` casuale di almeno 32 caratteri e `GEMINI_API_KEY`. `CATCHA_USERS_JSON` è facoltativa. Genera il segreto in locale con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` e configuralo nei segreti Render. `NODE_ENV=production` è già dichiarato. Non riutilizzare password già condivise.
4. Attendi che il controllo `/healthz` risulti valido, poi apri l'indirizzo HTTPS `*.onrender.com` assegnato al servizio.

Gli utenti creati dall'amministratore sono salvati in `users.json` sotto `CATCHA_DATA_DIR`, con sale casuali e hash scrypt (mai password in chiaro); il server non espone via HTTP né questo file né i file delle liste. `progress` e `savedBusinesses` sono conservati in file JSON separati per username, con scritture atomiche; il server valida i dati in ingresso. In locale la cartella `data/` è esclusa da Git. Questo storage è adatto a una singola istanza Node. Per più istanze o scritture concorrenti su larga scala, usa un database gestito, ad esempio PostgreSQL, invece dei file.

Il piano gratuito Render non offre un filesystem persistente: i file in `data/` possono sparire a un riavvio o a un nuovo deploy. In tal caso gli utenti creati dalla pagina Admin e le loro liste salvate possono andare persi e gli account gestiti manualmente andranno ricreati. Gli account definiti in `CATCHA_USERS_JSON` e l'account admin configurato nelle variabili d'ambiente restano invece configurati lì, ma le loro liste su file non sono garantite. Per conservare account e dati, serve uno storage persistente o un database. Le sessioni restano in memoria e richiedono un nuovo login dopo un riavvio. Anche Gemini e i servizi pubblici OpenStreetMap hanno limiti e condizioni d'uso separati dall'hosting.

Ogni account ha una sessione e una lista separate; `progress` e `savedBusinesses` vengono caricati e salvati sul server, così sono disponibili da altri dispositivi che accedono allo stesso account. Al primo accesso, eventuali liste legacy presenti nel browser vengono trasferite solo se l'account non ha ancora dati server; poi le vecchie chiavi locali vengono rimosse. Se più persone usavano lo stesso browser con le vecchie credenziali condivise, il primo account che effettua la migrazione riceve quella lista: controlla l'associazione prima di abilitare gli altri account.

## Configurare Gemini

Per abilitare la proposta personalizzata, il brief per il sito e la stima orientativa, crea una chiave in [Google AI Studio](https://aistudio.google.com/apikey). Salvala come variabile d'ambiente utente Windows chiamata `GEMINI_API_KEY` (da **Variabili d'ambiente per l'account**); non inserirla nei file del progetto, nel browser o in chat. Chiudi e riapri PowerShell/VS Code dopo averla salvata, poi avvia il server con il comando sopra. La chiave viene letta solo dal server e non viene inviata al browser. Se non è configurata, le funzioni AI mostrano una spiegazione e la ricerca delle attività continua a funzionare.

Catcha usa Gemini 3.8 Flash con ragionamento a bassa latenza; se il modello è sovraccarico o scade, riprova automaticamente con Gemini 3.5 Flash-Lite. Invia a Google solo i dati descrittivi dell'attività, il contesto facoltativo e, per la stima, la descrizione testuale del progetto quando premi il relativo pulsante. Non invia i recapiti OSM e non visita URL incollati. Non includere dati riservati. Limiti, disponibilità e possibili costi dipendono dal progetto Google configurato. La stima è indicativa, non un preventivo professionale.

## Fonti dati e limiti operativi

- Non ci sono attività precaricate o conteggi inventati: i risultati appaiono solo dopo una ricerca, tramite l'API pubblica Photon basata sui dati OpenStreetMap. Per città e regioni il server trova prima la località con Nominatim. Le ricerche per città e GPS coprono un raggio di 15 km; quelle per regione usano il confine rettangolare restituito da Nominatim, poi filtrano i risultati per regione quando Photon fornisce questo dato. Photon restituisce al massimo 50 attività, mostrate in pagine da 12 risultati. Catcha non registra la posizione o i termini cercati. I dati cartografici possono essere incompleti o non aggiornati in tempo reale.
- «Sito da verificare» è intenzionale: Photon non conferma se un'attività abbia un sito web. Per i recapiti, Catcha arricchisce i risultati con una richiesta raggruppata a Nominatim per i dati OSM; email, telefoni e siti vengono mostrati solo se la scheda li pubblica. Verifica sempre i canali ufficiali. Catcha non mostra conteggi di interesse di altri utenti; le liste personali sono conservate separatamente per account.
- Le foto non sono fornite dalla ricerca Photon: se una scheda OSM contiene un riferimento riutilizzabile a Wikimedia Commons, Catcha può mostrare la relativa immagine. Le immagini di Google Maps non vengono copiate.
- OpenStreetMap è una mappa collaborativa, non un registro in tempo reale né una fonte completa. La geocodifica usa il servizio pubblico Nominatim e la ricerca attività il servizio pubblico Photon; entrambi possono avere limiti di disponibilità e copertura.
- Le funzioni di proposta, brief e stima usano Gemini lato server se è configurata `GEMINI_API_KEY`. Il brief è generato per l'attività selezionata; l'utente può copiarlo e aprire la piattaforma di creazione siti scelta. L'AI può sbagliare: verifica i contenuti, le ipotesi e la fascia di prezzo prima di usarli.
- La ricevuta è un fac-simile non fiscale, da verificare prima di qualsiasi utilizzo.
- Le credenziali sono configurate sul server tramite variabili d'ambiente. Non inserire password nel codice o in file pubblicati.

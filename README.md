# Autohaus Dörrschuck Radio

Musik, KI-Nachrichten und Live-Durchsagen unter https://radio.doerrschuck.de. Ein residenter Next.js/Socket.IO-Prozess auf Railway, mit der bestehenden PostgreSQL-Datenbank und FFmpeg. Kein AzuraCast und kein zusätzlicher Backend-Service.

## Programm

- Täglich 08:00–18:00 Uhr in `Europe/Berlin`, einschließlich automatischer Sommer-/Winterzeit.
- Nachrichten um 08:00, 09:00, …, 17:00 Uhr. Vorbereitung ab zehn Minuten vor dem Sendetermin. Um 18:00 Uhr endet die Musik; es gibt keine 18-Uhr-Ausgabe.
- Positives/ neutrales Magazin aus Mainz/Rheinhessen plus geeignete überregionale Meldungen. Ziel: drei bis vier Minuten, bei wenig belegtem Material kürzer. Jede Ausgabe enthält einen hörbaren KI-Hinweis.
- RSS-Meldungen der letzten 72 Stunden und die erreichbaren Artikeltexte der bekannten Verlage werden eingelesen, durch Eden AI redigiert und in einem zweiten Modellaufruf geprüft. Ungeeignete oder nicht belegte Ausgaben werden verworfen; gespeicherte alte Nachrichten werden nicht ersatzweise gesendet.
- Nachrichten unterbrechen die Musik am Sendetermin. Die Übertragung beginnt serverseitig zur vollen Stunde; Browser, Netzwerk und Lautsprecher verursachen typischerweise zusätzliche Pufferlatenz.
- Mikrofon-Durchsagen und Tab-Audio bleiben pro Zone verfügbar. Nach deren Ende kehrt die Zone zum zeitgesteuerten Programm zurück. Live-Durchsagen können auch außerhalb der Musikzeiten verwendet werden.

## Administration

Unter **Radioprogramm** stehen Musikpool, Audiodatei-Import, kostenpflichtige Musikgenerierung, Nachrichtentexte, Quellen, Vorschau und Fehlerstatus bereit. Musik wird ausschließlich auf ausdrücklichen Start erzeugt (drei Titel à drei Minuten, maximal 24 Titel); die Rotation selbst ruft keine Musik-API auf. Die Prompts orientieren sich an Showroom Velvet, Velvet Floorplan und Showroom Satin, ohne die ausgewählten Originaldateien zu ersetzen oder als diese auszugeben.

Audio liegt dauerhaft in der bestehenden PostgreSQL-Datenbank. Der lokale MP3-Cache ist ersetzbar. Nachrichtenaudio und zugehörige Jobs werden nach sieben Tagen gelöscht. Generierungsjobs verwenden Datenbank-Leases und höchstens drei Versuche pro Schlüssel. Railway muss mit **einer Instanz, ohne App Sleeping und ohne Deployment-Überlappung** laufen.

## Konfiguration im Hauptservice

| Variable | Bedeutung |
| --- | --- |
| `PG_URL` | Bestehende PostgreSQL-Verbindung |
| `DEVICE_API_KEY` | Gemeinsamer Geräteschlüssel |
| `ELEVENLABS_API_KEY` | Musik, TTS und Lesen der Stimmen |
| `ELEVENLABS_VOICE_ID` | Deutsche Moderationsstimme; produktiv Mona als „Mia“ |
| `ELEVENLABS_MUSIC_MODEL` | Standard `music_v2` |
| `ELEVENLABS_TTS_MODEL` | Standard `eleven_multilingual_v2` |
| `EDENAI_API_KEY` | Redaktion und Quellenprüfung |
| `EDENAI_MODEL` | Produktiv `gpt-6-luna` |
| `EDENAI_REVIEW_MODEL` | Produktiv `anthropic/claude-haiku-5-5` |
| `NEWS_REGION` | Standard `Mainz und Rheinhessen` |
| `NEWS_FEED_URLS` | Optional: HTTPS-RSS/Atom-URLs, kommagetrennt; erster Feed lokal |
| `RADIO_PUBLIC_URL` | `https://radio.doerrschuck.de` |
| `AUTH_URL` | `https://auth.doerrschuck.de` |
| `RADIO_ENABLED` | `false` deaktiviert das automatische Programm |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Optional: alternative Binärpfade |

Alte AzuraCast-Zonen werden beim Seed auf `radio` umgestellt; benutzerdefinierte Quellen und stumme Zonen bleiben erhalten. `AZURACAST_STREAM_URL` und die alten Logto-Variablen werden nicht mehr ausgewertet. Der Start synchronisiert das additive Prisma-Schema ohne `--accept-data-loss`.

## Anmeldung

Dieselbe zentrale Better-Auth-Sitzung wie AHD-DMS unter `auth.doerrschuck.de`, mit Cookie für `.doerrschuck.de`. Der Radioserver validiert die Sitzung zentral und gleicht die verifizierte E-Mail mit der lokalen `users`-Tabelle ab. `mali@autohaus-doerrschuck.de` und `info@autohaus-doerrschuck.de` sind Administratoren. `radio.doerrschuck.de` muss in den zentralen Listen für vertrauenswürdige Anwendungen und Login-Rückleitungen stehen.

## Entwicklung und Prüfung

```sh
npm ci
npx prisma generate
npx tsx --test tests/radio.test.ts
npm run build
npm run dev
```

`SKIP_AUTH=true` ist ausschließlich lokal erlaubt; der Produktionsserver verweigert damit den Start. `scripts/railway-local.py` stellt für lokale Prüfungen Railway-Variablen nur im Kindprozess bereit und verwendet die öffentliche Postgres-Verbindung. Es speichert und druckt keine Schlüssel. `scripts/radio-bootstrap.ts --music` erzeugt einen ersten Pool; `--news` erstellt eine Vorschau für die aktuelle Sendestunde und spielt sie nicht nachträglich aus.

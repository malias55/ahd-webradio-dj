# Autohaus Dörrschuck Radio

Musik, KI-Nachrichten und Live-Durchsagen unter https://radio.doerrschuck.de. Ein residenter Next.js/Socket.IO-Prozess auf Railway, mit der bestehenden PostgreSQL-Datenbank und FFmpeg. Kein AzuraCast und kein zusätzlicher Backend-Service.

## Programm

- Täglich um 07:00 Uhr ein türkisches Morgenmagazin; reguläre Musik 08:00–18:00 Uhr in `Europe/Berlin`, einschließlich automatischer Sommer-/Winterzeit. Für das Morgenmagazin ist 07:00–07:05 Uhr reserviert, anschließend Pause bis 08 Uhr.
- Deutsche Hauptnachrichten mit Elias um 08, 10, 12, 14 und 16 Uhr. Um 09, 11, 13, 15 und 17 Uhr wird derselbe gespeicherte männliche Hauptteil wiederverwendet: identische Hauptteil-UUID, keine neue Redaktion oder männliche Sprachgenerierung. Jede volle Stunde erhält eine eigene fertige Ausgabe mit frisch abgerufenem Wetter und Verkehr, gesprochen von Jane. Vorbereitung ab zehn Minuten vor dem Sendetermin. Frühe manuelle Vorbereitung erstellt nur den Hauptteil; Servicedaten werden erst innerhalb dieser zehn Minuten abgerufen. Fehlt der Hauptteil, wird der stündliche Service mit einem hörbaren Hinweis separat gesendet.
- Um 18:00 Uhr endet die Musik; es gibt keine 18-Uhr-Ausgabe.
- Positives/ neutrales Magazin aus Mainz/Rheinhessen plus geeignete überregionale Meldungen. Ziel: drei bis vier Minuten, bei wenig belegtem Material kürzer. Jede Ausgabe enthält einen hörbaren KI-Hinweis.
- RSS-Meldungen der letzten 72 Stunden und die erreichbaren Artikeltexte der bekannten Verlage werden eingelesen, durch Eden AI redigiert und in einem zweiten Modellaufruf geprüft. Ungeeignete oder nicht belegte Ausgaben werden verworfen; gespeicherte alte Nachrichten werden nicht ersatzweise gesendet.
- Deutsche Stimmen: Elias spricht immer die Hauptnachrichten; Jane ausschließlich den stündlichen Wetter- und Verkehrsblock. Im wiederverwendbaren Hauptteil steht keine Uhrzeit. Das Wetter nennt den Messzeitpunkt, der Verkehr den Abrufzeitpunkt.
- Wetter: [DWD-Daten über Bright Sky](https://brightsky.dev/), Beobachtungen im Umkreis von höchstens 30 km um Mainz und höchstens 90 Minuten alt, ergänzt um die verfügbare Dreistundenvorhersage. Verkehr: [Autobahn GmbH](https://verkehr.autobahn.de/o/autobahn/) für A60, A63 und A643 im Umkreis von 30 km, aktuelle Warnungen und aktive Sperrungen; zukünftige und abgelaufene Maßnahmen werden ausgeschlossen. Innerstädtische Straßen sind nicht abgedeckt. Die Durchsagen benennen diese begrenzte Abdeckung und melden Quellenausfälle ausdrücklich, statt freie Fahrt zu behaupten. Wetter und Verkehr werden aus strukturierten Daten formuliert, ohne zusätzliche Textmodell-Aufrufe. Abrufzeit, Messwerte, ausgewählte Meldungen, Datenlücken und Quellen liegen im Verlauf. Eine Ausgabe mit Servicedaten aus einer anderen Stunde oder einem mehr als zehn Minuten vor dem Sendetermin erfolgten Abruf wird nicht ausgestrahlt.
- Um 07 Uhr spricht Cavit ausschließlich Türkisch. Die ersten gesprochenen Worte sind exakt `Rahman ve Rahim olan Allah in adiyla. `, ohne Musik darunter. Danach beginnt das Magazin über die Türkei, den deutsch-türkischen Austausch und passende globale Themen. TRT-RSS liefert aktuelle Meldungen; DAAD-Beiträge dürfen bis zu sieben Tage alt sein und werden dann als Hintergrund bezeichnet.
- Wiederkehrendes Klangpaket: sechs einmalig bei ElevenLabs erzeugte Musik-/Effektbausteine. Bei deutschen Nachrichten sind Opener, Trenner und Schluss zeitlich vollständig von der Sprache getrennt; es gibt kein Musikbett unter Hauptnachrichten, Wetter oder Verkehr. Die türkische Mischung behält ihr leises Musikbett mit automatischer Absenkung. Auch deutsche Senderkennungen haben Musik nur vor und nach der Stimme (`dry-v2`); alte Kennungen bleiben gespeichert und werden nicht mehr verwendet. Eine gespeicherte Senderkennung folgt ungefähr nach je drei Musiktiteln. Die Bausteine werden wiederverwendet und dabei nicht erneut generiert.
- Nachrichten unterbrechen die Musik am Sendetermin. Die Übertragung beginnt serverseitig zur vollen Stunde; Browser, Netzwerk und Lautsprecher verursachen typischerweise zusätzliche Pufferlatenz.
- Mikrofon-Durchsagen und Tab-Audio bleiben pro Zone verfügbar. Nach deren Ende kehrt die Zone zum zeitgesteuerten Programm zurück. Live-Durchsagen können auch außerhalb der Musikzeiten verwendet werden.

## Administration

Unter **Radioprogramm** stehen Musikpool, Audiodatei-Import, kostenpflichtige Musikgenerierung, Nachrichtentexte, Quellen, Vorschau und Fehlerstatus bereit. Musik wird ausschließlich auf ausdrücklichen Start erzeugt (drei Titel à drei Minuten, maximal 24 Titel); die Rotation selbst ruft keine Musik-API auf. Die Prompts orientieren sich an Showroom Velvet, Velvet Floorplan und Showroom Satin, ohne die ausgewählten Originaldateien zu ersetzen oder als diese auszugeben.

Audio liegt dauerhaft in der bestehenden PostgreSQL-Datenbank. Der lokale MP3-Cache ist ersetzbar. Nachrichtenaudio einschließlich der wiederverwendeten Hauptteile bleibt 14 Tage erhalten, Erstellungsjobs und Ausstrahlungsprotokolle 90 Tage. Musik, Jingles und Hörbeispiele bleiben dauerhaft gespeichert. Generierungsjobs verwenden Datenbank-Leases und höchstens drei Versuche pro Schlüssel. Railway muss mit **einer Instanz, ohne App Sleeping und ohne Deployment-Überlappung** laufen.

## Konfiguration im Hauptservice

| Variable | Bedeutung |
| --- | --- |
| `PG_URL` | Bestehende PostgreSQL-Verbindung |
| `DEVICE_API_KEY` | Gemeinsamer Geräteschlüssel |
| `ELEVENLABS_API_KEY` | Musik, TTS und Lesen der Stimmen |
| `ELEVENLABS_MALE_VOICE_ID` | `1h6gHcRvQugDNZgdAo9N` (Elias), alle deutschen Hauptnachrichten |
| `ELEVENLABS_FEMALE_VOICE_ID` | `hOBDmVrVUuqtp1I3KsIq` (Jane), Wetter und Verkehr stündlich 08–17 Uhr |
| `ELEVENLABS_TURKISH_VOICE_ID` | `Q2IX97JeHBY3vNGzgM5s` (Cavit), Türkçe 07 Uhr |
| `NEWS_TR_FEED_URLS` | Optional: türkische RSS-Quellen, kommagetrennt |
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


## Klangpaket und Beispiel

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-imaging.ts
python3 scripts/railway-local.py npx tsx scripts/radio-demo.ts
```

Diese Befehle verwenden vorhandene Bausteine erneut; nur fehlende Assets werden kostenpflichtig erzeugt. Eine gewünschte Neugestaltung erhält eine neue `IMAGING_VERSION`, statt die laufenden Dateien zu überschreiben. Das Hörbeispiel liegt im Dashboard unter „Radioklang und Hörbeispiel“ und lokal in `artifacts/ahd-radio-hoerbeispiel.mp3`. Die frühere Musikdemo zeigt beide Stimmen nacheinander. Das aktuelle deutsche Nachrichtenbeispiel zeigt Elias im Hauptteil und Jane mit frischem Wetter und Verkehr, ohne Musik unter Sprache. Demo-Audio wird nicht automatisch ausgestrahlt. Nachrichtentexte, Stimme, Themenausgabe und Mischungstimeline werden zusammen gespeichert.


## Tagesverlauf und Speicherung

Der Tagesfilter im Radioprogramm verwendet die deutsche Ortszeit, auch an Tagen mit Zeitumstellung. `radio_assets` enthält die MP3-Binärdaten, UUID, Erstellungszeit, Transkript, Quellen und bei neuen Nachrichten die angefragten/aufgelösten KI-Modelle, gemeldeten Tokenmengen und Mischungs-Timeline. Der bestehende Postgres reicht dafür aus; es gibt keinen zusätzlichen Bucket. `radio_playbacks` protokolliert Start, Ende, Status, geplanten Sendetermin, Wiederholung und die Zahl der Stream-Verbindungen beim Start. Fehlende Ausgaben und Unterbrechungen bleiben erkennbar. Das ist ein Protokoll des Server-Streams, keine Bestätigung der akustischen Wiedergabe auf jedem Gerät.

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-news-examples.ts
python3 scripts/railway-local.py npx tsx scripts/radio-repeat-e2e.ts
```

Die beiden Beispiele stehen im Dashboard und als `artifacts/nachrichten-mainz-de.mp3` und `artifacts/haberler-turkiye-tr.mp3` mit passenden `.txt`-Transkripten und `.json`-Metadaten bereit. Hörbeispiele werden nie automatisch ausgestrahlt. Der Wiederholungstest arbeitet mit isolierten, anschließend entfernten Datenbank-Fixtures: derselbe Hauptteil, unterschiedliche stündliche Audiodateien und Wetterstände, ausschließlich weibliche TTS-Aufrufe, keine Modellaufrufe bei Wiederverwendung, Service auch bei fehlendem Hauptteil und ein persistiertes Ausstrahlungsprotokoll. Ein FFmpeg-Test misst mit einer synthetischen Stimme die tatsächlichen Sprachintervalle und prüft, dass dort keine Musik oder Effekte zugemischt sind.

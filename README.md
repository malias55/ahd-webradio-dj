# Autohaus Dörrschuck Radio

Musik, KI-Nachrichten und Live-Durchsagen unter https://radio.doerrschuck.de. Ein residenter Next.js/Socket.IO-Prozess auf Railway, mit der bestehenden PostgreSQL-Datenbank und FFmpeg. Kein AzuraCast und kein zusätzlicher Backend-Service.

## Programm

- Täglich um 07:00 Uhr ein türkisches Morgenmagazin; reguläre Musik 08:00–18:00 Uhr in `Europe/Berlin`, einschließlich automatischer Sommer-/Winterzeit. Für das Morgenmagazin ist 07:00–07:05 Uhr reserviert, anschließend Pause bis 08 Uhr.
- Testbetrieb: genau eine neue türkische Ausgabe um 07:00 Uhr und eine neue deutsche Ausgabe um 08:00 Uhr pro Tag. Elias spricht den deutschen Hauptteil, Susanne ergänzt ausschließlich um 08:00 Uhr frisches Wetter und Verkehr. Keine weiteren stündlichen Ausgaben oder Service-Generierungen. Vorbereitung ab zehn Minuten vor dem Sendetermin; frühe manuelle Vorbereitung erstellt nur den Hauptteil. Alle anderen Stunden laufen ausschließlich aus dem vorhandenen Musikpool. Fehlende Hauptnachrichten werden im Service hörbar benannt.
- Um 18:00 Uhr endet die Musik; es gibt keine 18-Uhr-Ausgabe.
- Positives/ neutrales Magazin aus Mainz/Rheinhessen plus geeignete überregionale Meldungen. Ziel: drei bis vier Minuten, bei wenig belegtem Material kürzer. Jede Ausgabe enthält einen hörbaren KI-Hinweis.
- Deutsche Themenauswahl für den Schwerpunkt Verbrenner: sachliche lokale Kultur, Ausflugsziele, Reisen, Handwerk, Fahrzeugpflege und Fahrkultur. Keine lobenden E-Mobilitätsbeiträge oder indirekten Elektroauto-Erfolgsmeldungen über Ladeinfrastruktur/Batteriespeicher. Solche Quellen werden anhand von Titel, Zusammenfassung und Artikeltext vor der Redaktion aussortiert; Autor und Prüfer erhalten dieselben inhaltlichen Regeln. Keine Abwertung von Elektrofahrzeugen, keine erfundenen Vorteile für Verbrenner und keine kitschigen Kaufappelle oder als Nachrichten getarnte Werbung. Alte Hauptteile und Beispiele werden durch versionierte Schlüssel nicht weiterverwendet. Das türkische Programm sowie sachliche Wetter- und Verkehrsdaten bleiben davon unberührt.
- Ausschließlich jugendfreie Inhalte in beiden Sprachen: Quellenfilter, Vorgaben für Autor und unabhängigen Prüfer, zusätzliche Textprüfung vor TTS und Filter für gespeicherte Ausgaben. Keine Erotik, drastischen Darstellungen, Horror, Drogen-/Glücksspielwerbung oder nicht jugendfreien Kulturtipps. Notwendige Wetter-/Verkehrswarnungen bleiben sachlich erhalten; rohe Unfall- oder Verletzungsbeschreibungen werden nicht vorgelesen. Susanne moderiert den Service klar und lebendig (Stabilität 0,4; Tempo 1,06), mit kürzeren, aus strukturierten Fakten gebildeten Sätzen.
- RSS-Meldungen der letzten 72 Stunden und die erreichbaren Artikeltexte der bekannten Verlage werden eingelesen, durch Eden AI redigiert und in einem zweiten Modellaufruf geprüft. Ungeeignete oder nicht belegte Ausgaben werden verworfen; gespeicherte alte Nachrichten werden nicht ersatzweise gesendet.
- Deutsche Stimmen: Elias spricht immer die Hauptnachrichten; Susanne ausschließlich den Wetter- und Verkehrsblock um 08 Uhr. Im wiederverwendbaren Hauptteil steht keine Uhrzeit. Das Wetter nennt den Messzeitpunkt, der Verkehr den Abrufzeitpunkt.
- Wetter: [DWD-Daten über Bright Sky](https://brightsky.dev/), Beobachtungen im Umkreis von höchstens 30 km um Mainz und höchstens 90 Minuten alt, ergänzt um die verfügbare Dreistundenvorhersage. Verkehr: [Autobahn GmbH](https://verkehr.autobahn.de/o/autobahn/) für A60, A63 und A643 im Umkreis von 30 km, aktuelle Warnungen und aktive Sperrungen; zukünftige und abgelaufene Maßnahmen werden ausgeschlossen. Innerstädtische Straßen sind nicht abgedeckt. Die Durchsagen benennen diese begrenzte Abdeckung und melden Quellenausfälle ausdrücklich, statt freie Fahrt zu behaupten. Wetter und Verkehr werden aus strukturierten Daten formuliert, ohne zusätzliche Textmodell-Aufrufe. Abrufzeit, Messwerte, ausgewählte Meldungen, Datenlücken und Quellen liegen im Verlauf. Eine Ausgabe mit Servicedaten aus einer anderen Stunde oder einem mehr als zehn Minuten vor dem Sendetermin erfolgten Abruf wird nicht ausgestrahlt.
- Um 07 Uhr spricht Cavit ausschließlich Türkisch. Die ersten gesprochenen Worte sind exakt `Rahmân ve Rahîm olan Allah'ın adıyla. `, ohne Musik darunter. Der Einstieg wird einmal mit türkischem Sprachcode und der gewählten Stimme erzeugt und danach ohne weitere TTS-Kosten wiederverwendet (`tr-dry-opening-v3`); versionierte Sendeschlüssel verhindern die Wiederverwendung des alten Einstiegs. Danach beginnt das Magazin über die Türkei, den deutsch-türkischen Austausch und passende globale Themen. TRT-RSS liefert aktuelle Meldungen; DAAD-Beiträge dürfen bis zu sieben Tage alt sein und werden dann als Hintergrund bezeichnet.
- Wiederkehrendes Klangpaket: sechs einmalig bei ElevenLabs erzeugte Musik-/Effektbausteine. Bei allen Nachrichten sind Opener, Übergänge und Schluss zeitlich vollständig von der Sprache getrennt; es gibt kein Musikbett unter Hauptnachrichten, Wetter oder Verkehr. Einzelne Meldungen sind nur durch kurze Pausen getrennt. Die deutsche Ausgabe enthält zwischen allen Beiträgen ausschließlich Sprache und kurze Pausen; nach dem letzten gesprochenen Wort folgt ein rund vier Sekunden langer, energischer Abschluss (`imaging:de-energetic-outro-v3`). Die türkische Ausgabe verwendet nach dem gesprochenen Einstieg und am Ende den vom Nutzer ausgewählten und am stillen Ende gekürzten Intro-Sound (`imaging:tr-approved-intro-v1`). Kein Sound unter Sprache oder zwischen einzelnen Meldungen. Vor dem musikalischen Abschluss liegen rund 0,38 Sekunden Abstand zum Ende der Sprach-Timeline. Der türkische Schluss lautet exakt „Keyifli günler dileriz. Allah'ın selamı üzerinize olsun.“ Einstieg, Begrüßung und Abschluss sind feste, gespeicherte Sprachbausteine: „Autohaus Dörşuk“. Die zentrale türkische Ausspracheliste übergibt „TRT“ als „TERETE“ an TTS; Quellen und redaktionelle Fakten bleiben unverändert. Auch deutsche Senderkennungen haben Musik nur vor und nach der Stimme (`dry-v2`); alte Kennungen bleiben gespeichert und werden nicht mehr verwendet. Eine gespeicherte Senderkennung folgt ungefähr nach je drei Musiktiteln. Die Bausteine werden wiederverwendet und dabei nicht erneut generiert.
- Nachrichten unterbrechen die Musik am Sendetermin. Die Übertragung beginnt serverseitig zur vollen Stunde; Browser, Netzwerk und Lautsprecher verursachen typischerweise zusätzliche Pufferlatenz.
- Mikrofon-Durchsagen und Tab-Audio bleiben pro Zone verfügbar. Nach deren Ende kehrt die Zone zum zeitgesteuerten Programm zurück. Live-Durchsagen können auch außerhalb der Musikzeiten verwendet werden.

## Administration

Unter **Nachrichten** können alle angemeldeten Nutzer die tatsächlich erstellten Ausgaben der letzten 14 Tage direkt abspielen, inklusive Transkript, Quellen und Zeitstempeln. Korrigierte Ausgaben ersetzen im Archiv die alte Fassung desselben Sendetermins; das Ausstrahlungsprotokoll bewahrt die ursprüngliche Datei.

Unter **Radioprogramm** stehen Musikpool, Audiodatei-Import, Nachrichtentexte, Quellen, Vorschau und Fehlerstatus bereit. Generierungsbuttons und Web-Generierungsaktionen sind deaktiviert (POST-JSON erhält HTTP 403). Der automatische Morgenplan und serverseitige Wartungsskripte bleiben aktiv. Musik wird ausschließlich durch einen ausdrücklichen Backend-Aufruf erzeugt (drei Titel à drei Minuten, maximal 24 Titel); die Rotation selbst ruft keine Musik-API auf. Die Prompts orientieren sich an Showroom Velvet, Velvet Floorplan und Showroom Satin, ohne die ausgewählten Originaldateien zu ersetzen oder als diese auszugeben.

Audio liegt dauerhaft in der bestehenden PostgreSQL-Datenbank. Der lokale MP3-Cache ist ersetzbar. Nachrichtenaudio einschließlich der wiederverwendeten Hauptteile bleibt 14 Tage erhalten, Erstellungsjobs und Ausstrahlungsprotokolle 90 Tage. Musik, Jingles und Hörbeispiele bleiben dauerhaft gespeichert. Generierungsjobs verwenden Datenbank-Leases und höchstens drei Versuche pro Schlüssel. Railway muss mit **einer Instanz, ohne App Sleeping und ohne Deployment-Überlappung** laufen.

## Konfiguration im Hauptservice

| Variable | Bedeutung |
| --- | --- |
| `PG_URL` | Bestehende PostgreSQL-Verbindung |
| `DEVICE_API_KEY` | Gemeinsamer Geräteschlüssel |
| `ELEVENLABS_API_KEY` | Musik, TTS und Lesen der Stimmen |
| `ELEVENLABS_MALE_VOICE_ID` | `1h6gHcRvQugDNZgdAo9N` (Elias), alle deutschen Hauptnachrichten |
| `ELEVENLABS_SERVICE_VOICE_ID` | `mjTSjCqHhkhULvdsy68o` (Susanne), Wetter und Verkehr um 08 Uhr |
| `ELEVENLABS_SERVICE_VOICE_NAME` | `Susanne` |
| `ELEVENLABS_TURKISH_VOICE_ID` | `Q2IX97JeHBY3vNGzgM5s` (Cavit), Türkçe 07 Uhr |
| `NEWS_TR_FEED_URLS` | Optional: türkische RSS-Quellen, kommagetrennt |
| `ELEVENLABS_MUSIC_MODEL` | Standard `music_v2` |
| `ELEVENLABS_TTS_MODEL` | Standard `eleven_multilingual_v2` |
| `OPENAI_API_KEY` | Terra für Redaktion und Quellenprüfung |
| `EDENAI_API_KEY` | Haiku als technischer Ersatzpfad |
| `NEWS_MODEL` | `gpt-6.1-terra`, direkt über OpenAI für Autor und Prüfer |
| `EDENAI_FALLBACK_MODEL` | `anthropic/claude-haiku-5-5`, nur bei technischen Ausfällen |
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

`SKIP_AUTH=true` ist ausschließlich lokal erlaubt; der Produktionsserver verweigert damit den Start. `scripts/railway-local.py` stellt für lokale Prüfungen Railway-Variablen nur im Kindprozess bereit und verwendet die öffentliche Postgres-Verbindung. Es speichert und druckt keine Schlüssel. `scripts/radio-bootstrap.ts --music` erzeugt einen ersten Pool; `--news` bereitet die nächste geplante Morgenausgabe frühestens eine Stunde vorher vor; sie wird nicht nachträglich ausgestrahlt.


## Klangpaket und Beispiel

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-imaging.ts
python3 scripts/railway-local.py npx tsx scripts/radio-demo.ts
```

Diese Befehle verwenden vorhandene Bausteine erneut; nur fehlende Assets werden kostenpflichtig erzeugt. Eine gewünschte Neugestaltung erhält eine neue `IMAGING_VERSION`, statt die laufenden Dateien zu überschreiben. Das Hörbeispiel liegt im Dashboard unter „Radioklang und Hörbeispiel“ und lokal in `artifacts/ahd-radio-hoerbeispiel.mp3`. Die frühere Musikdemo zeigt beide Stimmen nacheinander. Das aktuelle deutsche Nachrichtenbeispiel zeigt Elias im Hauptteil und Susanne mit frischem Wetter und Verkehr, ohne Zwischenjingles oder Musik unter Sprache; mit einem kurzen Abschluss danach. Demo-Audio wird nicht automatisch ausgestrahlt. Nachrichtentexte, Stimme, Themenausgabe und Mischungstimeline werden zusammen gespeichert.


## Tagesverlauf und Speicherung

Der Tagesfilter im Radioprogramm verwendet die deutsche Ortszeit, auch an Tagen mit Zeitumstellung. `radio_assets` enthält die MP3-Binärdaten, UUID, Erstellungszeit, Transkript, Quellen und bei neuen Nachrichten die angefragten/aufgelösten KI-Modelle, gemeldeten Tokenmengen und Mischungs-Timeline. Der bestehende Postgres reicht dafür aus; es gibt keinen zusätzlichen Bucket. `radio_playbacks` protokolliert Start, Ende, Status, geplanten Sendetermin, Wiederholung und die Zahl der Stream-Verbindungen beim Start. Fehlende Ausgaben und Unterbrechungen bleiben erkennbar. Das ist ein Protokoll des Server-Streams, keine Bestätigung der akustischen Wiedergabe auf jedem Gerät.

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-news-examples.ts
python3 scripts/railway-local.py npx tsx scripts/radio-daily-e2e.ts
```

Die beiden Beispiele stehen im Dashboard und als `artifacts/nachrichten-mainz-de.mp3` und `artifacts/haberler-turkiye-tr.mp3` mit passenden `.txt`-Transkripten und `.json`-Metadaten bereit. Hörbeispiele werden nie automatisch ausgestrahlt. Der Morgentest arbeitet mit isolierten, anschließend entfernten Datenbank-Fixtures: tägliche Ausgaben, keine Generierung um 09 Uhr, kein erneuter TTS-Kauf bei gecachter Ausgabe, Service erst kurz vor dem Termin, Fehler-Fallback und persistiertes Ausstrahlungsprotokoll. Ein FFmpeg-Test misst synthetische Sprachintervalle in der deutschen und türkischen Mischung sowie Senderkennungen und prüft, dass dort keine Musik oder Effekte zugemischt sind.


Für reine Klangkorrekturen ohne neue Redaktion oder TTS:

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-divider.ts
python3 scripts/railway-local.py npx tsx scripts/radio-remix-example.ts <UUID-des-deutschen-Hörbeispiels>
```

Der Remix verwendet ausschließlich die dokumentierten Sprachintervalle einer trockenen deutschen Beispielausgabe; Texte, Quellen und ursprüngliche Wetter-/Verkehrsstände bleiben erhalten. Neue UUIDs dokumentieren Originaldatei und Mischung. Die kurze Vorschau liegt in `artifacts/uebergaenge-neu-hoerprobe.mp3`, die vollständige Ausgabe in `artifacts/nachrichten-mainz-de-sanfte-uebergaenge.mp3`.

Türkische Klang- und Aussprachekorrekturen verwenden vorhandene, geprüfte Meldungen erneut. Nur geänderte Aussprache und noch fehlende statische Sprachbausteine benötigen neue TTS-Aufrufe; kein Textmodell-Aufruf:

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-turkish-signature.ts "/pfad/zum/freigegebenen-intro.opus"
python3 scripts/railway-local.py npx tsx scripts/radio-turkish-refresh.ts <UUID-der-trockenen-Ausgabe>
```

Die korrigierte Fassung erhält eine neue UUID und erscheint im Nachrichtenarchiv. Das ursprüngliche Ausstrahlungsprotokoll bleibt erhalten.

Autor und Prüfer verwenden direkt `gpt-6.1-terra`. Nur bei technischen Anbieterfehlern wird einmalig Eden AI / Haiku 5.5 verwendet. Redaktionelle Ablehnungen, Sicherheitsverweigerungen und Inhaltsfilter lösen keinen Modellwechsel aus. Beide Versuche samt Provider, tatsächlich aufgelöstem Modell, Status und Tokenverbrauch werden protokolliert. Historische Autorenangaben bleiben korrekt erhalten.

Gesprochene Meldungen enthalten weder Mess-/Abrufzeiten noch Dashboard- oder Panel-Verweise. Datenstände und Quellen bleiben ausschließlich im Archiv sichtbar; nützliche Ereigniszeiten, Sperrfristen und Abdeckungshinweise bleiben erhalten.

Die Schlussklänge werden einmalig generiert bzw. aus dem freigegebenen türkischen Klang übernommen und danach wiederverwendet. Deutsche Varianten wurden als echte Audioeingaben mit `gpt-audio-1.5` verglichen; Claude Opus 5.5 im CLI prüfte die Höranalysen, Texte und Messdaten. Opus hat dabei keinen direkten Audioinput und wird nicht als selbst hörender Prüfer ausgegeben. Die Nachrichtenredaktion bleibt unverändert Terra mit Haiku als technischem Ersatzpfad.

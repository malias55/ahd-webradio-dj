# Autohaus Dörrschuck Radio

Musik, KI-Nachrichten und Live-Durchsagen unter https://radio.doerrschuck.de. Ein residenter Next.js/Socket.IO-Prozess auf Railway, mit der bestehenden PostgreSQL-Datenbank und FFmpeg. Kein AzuraCast und kein zusätzlicher Backend-Service.

## Programm

- Seit 09.11.2026 ist die Rotation auf sanfte Hintergrundmusik ohne Bläser ausgerichtet. Alle acht vollständigen Aufnahmen und zusätzlich ihre lückenlosen Ein-Minuten-Abschnitte wurden mit einem Audio-Modell geprüft; Entscheidungen und Dateiprüfsummen stehen in `src/lib/radio/music-review-2026-11-09.json` und in den Asset-Metadaten. `Showroom Satin · Boulevard` bleibt wegen des ursprünglichen Tenorsaxofon-Auftrags vorsorglich ausgeschlossen. Die Abschnittsprüfung beschrieb bei `Showroom Satin 1`, `Velvet Floorplan 1` und `Showroom Velvet · Sunlit` auch synthetische Bläser- bzw. Flötenklänge; diese Titel bleiben ebenfalls außerhalb der Rotation. Es bleiben `Showroom Velvet 1`, `Showroom Velvet · Daylight`, `Velvet Floorplan · Panorama` und `Velvet Floorplan · Café` mit zusammen etwa 15 Minuten Musik. Die Prüfung ist automatisiert, keine menschliche Hörabnahme. Audio und Sendehistorie bleiben erhalten. Die Vorgabe für zukünftige Musik schließt sämtliche Blasinstrumente, synthetische Bläser, dominante Soli und scharfe Klangspitzen aus. Es wurde keine neue Musik gekauft oder erzeugt; Nachrichten, Intro und Outro bleiben unverändert.
- Reguläre Musik täglich 07:00–21:00 Uhr in `Europe/Berlin`, einschließlich automatischer Sommer-/Winterzeit. Türkische Nachrichten beginnen um 07:00 und 21:00 Uhr (Mo–Sa); die letzte Ausgabe darf bis 21:05 Uhr auslaufen. Sendepausen sind 04–07 Uhr und nach den Abendnachrichten bis 22 Uhr.
- Hatim täglich 22:00–04:00 Uhr, auch sonntags: vollständige Rezitation von Mishary Alafasy (Hafs), 114 Suren. Quelle: [MP3Quran](https://mp3quran.net/eng/afs), [Nutzungserlaubnis](https://mp3quran.org/eng/privacy), [offizielle API](https://apiquran.mp3quran.net/ar/api). Audios werden direkt geladen und kurzzeitig lokal zwischengespeichert. Die geprüften Verszeitmarken liegen in `src/lib/radio/hatim-manifest.json`. `hatim_progress` speichert alle zehn Sekunden die tatsächlich ausgegebene Position sowie abgeschlossene Durchläufe in Postgres. Vor 04 Uhr endet die Rezitation am letzten vollständig passenden Vers (Restzeit Stille); in der nächsten Nacht geht es weiter. Nach einer Unterbrechung wird der angefangene Vers vollständig wiederholt. Nach Sure 114 beginnt Sure 1. Keine TTS- oder Textmodell-Aufrufe.
- Zwei tägliche KI-Redaktionen ab 06 Uhr (Türkisch) und 07 Uhr (Deutsch). Ab 06.11.2026 werden die Hauptmeldungen weiterverwendet und rund sechs Minuten vor jeder türkischen Sendung mit aktuellen Marktdaten ergänzt. Türkisch um 07 und 21 Uhr mit längerem Hauptteil, bei geeigneten Quellen auch Wirtschaft und Sport, plus Gold, Brent, EZB-Referenzkursen und BIST 100. Deutsch stündlich von 08 bis 20 Uhr ohne Wetter und Verkehr; dieselbe fertige Tagesausgabe wird wiederverwendet. Für die Datenblöcke gibt es keine Modellaufrufe. Identische Sprachabschnitte desselben Tages werden wiederverwendet. Marktdaten aus dem Tagesbericht werden als solche datiert. Nicht ausreichend frische Kurse werden ausgelassen.
- Um 18:00 Uhr endet die Musik; es gibt keine 18-Uhr-Ausgabe.
- Positives und neutrales deutsches Magazin aus Mainz/Rheinhessen plus geeignete überregionale Meldungen. Nach redaktionellem Ermessen kann es eine sachliche politische Meldung von außergewöhnlicher Tragweite enthalten. Die türkische Ausgabe deckt die wichtigsten belegten Entwicklungen aus der Türkei, Deutschland und der Welt ab. Bedeutende Wahlen und Regierungswechsel haben Vorrang vor Kultur und Technik. Beide Ausgaben kennzeichnen vorläufige Wahlergebnisse und bleiben ohne Parteinahme. Jede Ausgabe enthält einen hörbaren KI-Hinweis.
- Die türkische Redaktion gleicht ihre Themen mit bis zu sieben früheren Tagesausgaben ab. Sie schließt bereits verwendete Artikel aus und behandelt ein bekanntes Ereignis nur bei einer neuen, belegten und wesentlichen Entwicklung. TRT-Manşet, TRT-Dünya und der Weltfeed von Anadolu Ajansı liefern zusätzliche Hauptmeldungen. Für die deutsche Redaktion kommen die Nachrichten des Deutschlandfunks hinzu.
- Deutsche Themenauswahl für den Schwerpunkt Verbrenner: sachliche lokale Kultur, Ausflugsziele, Reisen, Handwerk, Fahrzeugpflege und Fahrkultur. Keine lobenden E-Mobilitätsbeiträge oder indirekten Elektroauto-Erfolgsmeldungen über Ladeinfrastruktur/Batteriespeicher. Solche Quellen werden anhand von Titel, Zusammenfassung und Artikeltext vor der Redaktion aussortiert; Autor und Prüfer erhalten dieselben inhaltlichen Regeln. Keine Abwertung von Elektrofahrzeugen, keine erfundenen Vorteile für Verbrenner und keine kitschigen Kaufappelle oder als Nachrichten getarnte Werbung. Alte Hauptteile und Beispiele werden durch versionierte Schlüssel nicht weiterverwendet. Das türkische Programm sowie sachliche Wetter- und Verkehrsdaten bleiben davon unberührt.
- Ausschließlich jugendfreie Inhalte in beiden Sprachen: Quellenfilter, Vorgaben für Autor und unabhängigen Prüfer, zusätzliche Textprüfung vor TTS und Filter für gespeicherte Ausgaben. Keine Erotik, drastischen Darstellungen, Horror, Drogen-/Glücksspielwerbung oder nicht jugendfreien Kulturtipps. Notwendige Wetter-/Verkehrswarnungen bleiben sachlich erhalten; rohe Unfall- oder Verletzungsbeschreibungen werden nicht vorgelesen. Susanne moderiert den Service klar und lebendig (Stabilität 0,4; Tempo 1,06), mit kürzeren, aus strukturierten Fakten gebildeten Sätzen.
- RSS-Meldungen der letzten 72 Stunden und die erreichbaren Artikeltexte der bekannten Verlage werden eingelesen, durch Eden AI redigiert und in einem zweiten Modellaufruf geprüft. Ungeeignete oder nicht belegte Ausgaben werden verworfen; gespeicherte alte Nachrichten werden nicht ersatzweise gesendet.
- Deutsche Stimmen: Elias spricht die täglichen Hauptmeldungen. Wetter und Verkehr sind bis auf Weiteres vollständig pausiert (kein Abruf und keine Vertonung). Mit `NEWS_WEATHER_TRAFFIC_ENABLED=true` kann der stündliche Service mit Susanne wieder eingeschaltet werden; standardmäßig ist er aus. Für die 13 deutschen Sendetermine wird nur eine Tagesaufnahme erstellt.
- Bei wieder eingeschaltetem Service: Wetter über [DWD-Daten über Bright Sky](https://brightsky.dev/), Beobachtungen im Umkreis von höchstens 30 km um Mainz und höchstens 90 Minuten alt, ergänzt um die verfügbare Dreistundenvorhersage. Verkehr: [Autobahn GmbH](https://verkehr.autobahn.de/o/autobahn/) für A60, A63 und A643 im Umkreis von 30 km, aktuelle Warnungen und aktive Sperrungen; zukünftige und abgelaufene Maßnahmen werden ausgeschlossen. Innerstädtische Straßen sind nicht abgedeckt. Die Durchsagen benennen diese begrenzte Abdeckung und melden Quellenausfälle ausdrücklich, statt freie Fahrt zu behaupten. Wetter und Verkehr werden aus strukturierten Daten formuliert, ohne zusätzliche Textmodell-Aufrufe. Abrufzeit, Messwerte, ausgewählte Meldungen, Datenlücken und Quellen liegen im Verlauf. Der stündliche Service verwendet eine Momentaufnahme kurz vor der Sendung. Tagesaufnahmen bis einschließlich 05.11.2026 behalten ihren ursprünglichen Datenstand.
- Um 07 und 21 Uhr spricht Cavit ausschließlich Türkisch. Die ersten gesprochenen Worte sind exakt `Rahmân ve Rahîm olan Allah'ın adıyla. `, ohne Musik darunter. Der Einstieg wird einmal mit türkischem Sprachcode und der gewählten Stimme erzeugt und danach ohne weitere TTS-Kosten wiederverwendet (`tr-dry-opening-v3`); versionierte Sendeschlüssel verhindern die Wiederverwendung des alten Einstiegs. Danach beginnt das Magazin über die Türkei, den deutsch-türkischen Austausch und passende globale Themen. TRT-RSS liefert aktuelle Meldungen; DAAD-Beiträge dürfen bis zu sieben Tage alt sein und werden dann als Hintergrund bezeichnet.
- Wiederkehrendes Klangpaket: sechs einmalig bei ElevenLabs erzeugte Musik-/Effektbausteine. Bei allen Nachrichten sind Opener, Übergänge und Schluss zeitlich vollständig von der Sprache getrennt; es gibt kein Musikbett unter Hauptnachrichten, Wetter oder Verkehr. Deutsche Meldungen sind nur durch kurze Pausen getrennt. Die deutsche Ausgabe enthält zwischen allen Beiträgen ausschließlich Sprache und kurze Pausen; nach dem letzten gesprochenen Wort folgt ein rund vier Sekunden langer, energischer Abschluss (`imaging:de-energetic-outro-v3`). Ab dem 06.11.2026 verwenden beide Ausgaben die vom Nutzer gelieferte Kennung (`imaging:approved-bulletin-opener-2026-11-06`). Im türkischen Programm folgt sie auf den gesprochenen Einstieg, im deutschen steht sie vor der Begrüßung. Die türkische Schlussmusik bleibt `imaging:tr-approved-intro-v1`. Zwischen türkischen Meldungen bleiben ausschließlich die natürlichen Sprechpausen von rund 0,7 Sekunden. Alle bisher erzeugten türkischen Zwischentöne, einschließlich `imaging:tr-broadcast-divider-v3`, sind verworfen und werden auch dann nicht verwendet, wenn die Assets noch gespeichert sind. Die heutige Tagesaufnahme wurde ausschließlich aus gespeicherten Sprachabschnitten ohne neue Provideraufrufe neu gemischt; das Sendeprotokoll bewahrt die tatsächlich ausgestrahlte Originaldatei. Vor dem musikalischen Abschluss liegen rund 0,38 Sekunden Abstand zum Ende der Sprach-Timeline. Der türkische Schluss lautet exakt „Keyifli günler dileriz. Allah'ın selamı üzerinize olsun.“ Einstieg, Begrüßung und Abschluss sind feste, gespeicherte Sprachbausteine: „Autohaus Dörşuk“. Die zentrale türkische Ausspracheliste übergibt „TRT“ als „TERETE“ an TTS; Quellen und redaktionelle Fakten bleiben unverändert. Auch deutsche Senderkennungen haben Musik nur vor und nach der Stimme (`neutral-dry-v3`); alte Kennungen bleiben gespeichert und werden nicht mehr verwendet. Eine verfügbare neutrale Senderkennung folgt ungefähr nach je drei Musiktiteln; ohne gespeicherte neutrale Kennung läuft die Musik weiter. Die Bausteine werden wiederverwendet und dabei nicht erneut generiert.
- Bei einer verfügbaren Nachrichtenausgabe blendet die laufende Musik vor dem Sendetermin innerhalb von drei Sekunden aus. Vor dem Nachrichtenblock folgen mindestens fünf Sekunden Stille, nach seinem Ende nochmals fünf Sekunden. Läuft das Musikprogramm anschließend weiter, blendet der nächste Titel innerhalb von drei Sekunden ein. Der Server zielt auf die volle Stunde. Bei einer erst kurzfristig verfügbaren Ausgabe verschiebt sich der Beginn um die Übergangszeit. Browser, Netzwerk und Lautsprecher können zusätzlich puffern.
- Zum Lautstärkeausgleich erhält der fertige Nachrichtenblock bei der Ausstrahlung einmalig +6 dB mit einem Spitzenbegrenzer bei −2 dBFS ohne automatische Nachverstärkung. Derselbe Filter gilt für automatische und manuelle Zonennachrichten in beiden Sprachen, einschließlich Intro und Outro. Musik und Zonenlautstärke bleiben unverändert. Gespeicherte Originaldateien und Archivvorschauen bleiben im ursprünglichen Pegel; Wiederholungen addieren keine weitere Verstärkung.
- In der Steuerung lässt sich nach Bestätigung pro Zone die letzte fertige deutsche oder türkische Ausgabe des Tages abspielen und abbrechen. Dabei wird die fertige Aufnahme einschließlich Intro und Outro verwendet. Beim Abbruch kehrt die Zone zum normalen Programm zurück. Beim Autohaus-Radio wird der Ton wieder eingeblendet.
- Mikrofon-Durchsagen und Tab-Audio bleiben pro Zone verfügbar. Nach deren Ende kehrt die Zone zum zeitgesteuerten Programm zurück. Live-Durchsagen können auch außerhalb der Musikzeiten verwendet werden.

## Administration

Unter **Nachrichten** können alle angemeldeten Nutzer die tatsächlich erstellten Ausgaben der letzten 14 Tage direkt abspielen, inklusive Transkript, Quellen und Zeitstempeln. Korrigierte Ausgaben ersetzen im Archiv die alte Fassung desselben Sendetermins; das Ausstrahlungsprotokoll bewahrt die ursprüngliche Datei.

Unter **Radioprogramm** stehen Musikpool, Audiodatei-Import, Nachrichtentexte, Quellen, Vorschau und Fehlerstatus bereit. Generierungsbuttons und Web-Generierungsaktionen sind deaktiviert (POST-JSON erhält HTTP 403). Der automatische Morgenplan und serverseitige Wartungsskripte bleiben aktiv. Musik wird ausschließlich durch einen ausdrücklichen Backend-Aufruf erzeugt (Startpool: drei Titel à drei Minuten; Erweiterung: fünf Titel à vier Minuten; maximal 24 Titel); die Rotation selbst ruft keine Musik-API auf. Die Prompts orientieren sich an Showroom Velvet, Velvet Floorplan und Showroom Satin, ohne die ausgewählten Originaldateien zu ersetzen oder als diese auszugeben.

Audio liegt dauerhaft in der bestehenden PostgreSQL-Datenbank. Der lokale MP3-Cache ist ersetzbar. Nachrichtenaudio einschließlich der wiederverwendeten Hauptteile bleibt 14 Tage erhalten, Erstellungsjobs und Ausstrahlungsprotokolle 90 Tage. Musik, Jingles und Hörbeispiele bleiben dauerhaft gespeichert. Generierungsjobs verwenden Datenbank-Leases und höchstens drei Versuche pro Schlüssel. Railway muss mit **einer Instanz, ohne App Sleeping und ohne Deployment-Überlappung** laufen.

## Konfiguration im Hauptservice

| Variable | Bedeutung |
| --- | --- |
| `PG_URL` | Bestehende PostgreSQL-Verbindung |
| `DEVICE_API_KEY` | Gemeinsamer Geräteschlüssel |
| `ELEVENLABS_API_KEY` | Musik, TTS und Lesen der Stimmen |
| `ELEVENLABS_MALE_VOICE_ID` | `1h6gHcRvQugDNZgdAo9N` (Elias), alle deutschen Hauptnachrichten |
| `NEWS_WEATHER_TRAFFIC_ENABLED` | Standard `false`: Wetter/Verkehr weder abrufen noch erstellen. `true` aktiviert den stündlichen Service wieder |
| `ELEVENLABS_SERVICE_VOICE_ID` | Optionaler Override für Wetter und Verkehr. Ab dem 06.11.2026 standardmäßig `NX39CipaoYitJ3sMwH5I` (Franziska bei ElevenLabs, Susanne im Programm) |
| `ELEVENLABS_SERVICE_VOICE_NAME` | `Susanne` |
| `ELEVENLABS_TURKISH_VOICE_ID` | `Q2IX97JeHBY3vNGzgM5s` (Cavit), Türkçe 07 und 21 Uhr |
| `NEWS_TR_FEED_URLS` | Optional: türkische RSS-Quellen, kommagetrennt |
| `ELEVENLABS_MUSIC_MODEL` | Standard `music_v2_5`; Musik wird direkt mit 320 kbit/s angefordert |
| `ELEVENLABS_TTS_MODEL` | Standard `eleven_multilingual_v2` |
| `OPENAI_API_KEY` | Terra für Redaktion und Quellenprüfung |
| `EDENAI_API_KEY` | Haiku als technischer Ersatzpfad |
| `NEWS_MODEL` | `gpt-6.1-terra`, direkt über OpenAI für Autor und Prüfer |
| `EDENAI_FALLBACK_MODEL` | `anthropic/claude-haiku-5-5`, nur bei technischen Ausfällen |
| `NEWS_REGION` | Standard `Mainz und Rheinhessen` |
| `NEWS_FEED_URLS` | Optional: HTTPS-RSS/Atom-URLs, kommagetrennt; erster Feed lokal |
| `RADIO_PUBLIC_URL` | `https://radio.doerrschuck.de` |
| `AUTH_URL` | `https://auth.doerrschuck.de` |
| `DMS_URL` | `https://dms.doerrschuck.de`; prüft aktive DMS-Benutzer über `/api/session/status` |
| `RADIO_ENABLED` | `false` deaktiviert das automatische Programm |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Optional: alternative Binärpfade |

Alte AzuraCast-Zonen werden beim Seed auf `radio` umgestellt; benutzerdefinierte Quellen und stumme Zonen bleiben erhalten. `AZURACAST_STREAM_URL` und die alten Logto-Variablen werden nicht mehr ausgewertet. Der Start synchronisiert das additive Prisma-Schema ohne `--accept-data-loss`.

## Anmeldung

Dieselbe zentrale Better-Auth-Sitzung wie AHD-DMS unter `auth.doerrschuck.de`, mit Cookie für `.doerrschuck.de`. Der Radioserver validiert die verifizierte Identität und die noch gültige Sitzung zentral; anschließend bestätigt das DMS über `/api/session/status`, dass die Sitzung einem aktiven DMS-Benutzer gehört. Alle aktiven DMS-Benutzer erhalten dadurch automatisch Radio-Zugang, ohne zusätzliche Benutzeranlage oder Synchronisation. Ein zentraler Account ohne DMS-Zugang reicht nicht. Deaktivierte Benutzer, widerrufene/abgelaufene Sitzungen und fehlgeschlagene Prüfungen erhalten keinen Zugang. Die DMS-spezifische Ein-Gerät-Sperre (`superseded`, hostgebundenes `ahd_sid`) wird nicht auf Radio-Lautsprecher übertragen; eine explizite Sperre (`revoked`) wird berücksichtigt. Das Radio übernimmt keine DMS-Sitzung und ändert keine DMS-Benutzer.

Die lokale `users`-Tabelle dient nur noch den bestehenden Radio-Rollen und Anzeigenamen. Neue DMS-Benutzer erhalten `user`; bestehende Radio-Administratoren behalten `admin`. `mali@autohaus-doerrschuck.de` und `info@autohaus-doerrschuck.de` sind Administratoren. Diese Rollen umgehen die DMS-Prüfung nicht. `radio.doerrschuck.de` muss in den zentralen Listen für vertrauenswürdige Anwendungen und Login-Rückleitungen stehen. `SKIP_AUTH` wird in Produktion auch im Request-Proxy ignoriert.

## Entwicklung und Prüfung

Der Lautsprecher-Modus erhält den Audiopuffer des Browsers, statt bei drei Sekunden
Puffervorsprung nach vorn zu springen. Fehlgeschlagene Statusabfragen lassen den
laufenden Stream unverändert. Eine bestätigte Quellenänderung wechselt die
Quelle; Audio-Ende, Audiofehler und anhaltender Stillstand verbinden sie neu.
Statusabfragen laufen nacheinander mit fünf Sekunden Zeitlimit. Stoppen und
Zonenwechsel entfernen ausstehende Wiederverbindungen und verwerfen alte Antworten.
Ein eigener Wiedergabewächter prüft alle zwei Sekunden den tatsächlichen
Fortschritt der Audiozeit. Steht sie mindestens 15 Sekunden still, wird die
ausgewählte Quelle neu verbunden, auch wenn die HTTP-Verbindung offen bleibt
und der Browser keinen Audiofehler meldet. Kurzes Puffern wird abgewartet.
Beim Wiederverbinden bleibt dasselbe Audioelement erhalten; nur seine Verbindung
wird neu geladen. Alte, dadurch abgebrochene `play()`-Versuche können keinen
weiteren Neustart auslösen.
Die Oberfläche unterscheidet Verbindung, Puffern, Wiederverbinden und Wiedergabe.
Verweigert der Browser `play()` wegen fehlender Nutzerinteraktion, erscheint
„Ton freigeben“; zeitgesteuerte Wiederholungen umgehen diese Browsersperre nicht.
Die aktive Zone wird pro Tab in `sessionStorage` gespeichert. Die angemeldete
App stellt sie nach F5, vollständiger Navigation und Rückkehr aus dem
Browser-Seitencache automatisch wieder her, einschließlich außerhalb der
Steuerungsseite. Das Verlassen einer Seite beendet nur die laufenden Ressourcen;
„Lautsprecher-Modus beenden“ löscht zusätzlich die gespeicherte Auswahl und
verhindert eine Wiederaufnahme. Gesperrter Browserspeicher verhindert die normale
Wiedergabe nicht. Nach einem vollständigen Reload kann der Browser erneut einen
Klick auf „Ton freigeben“ verlangen; ein erzwungener Reload ist deshalb kein
allgemeiner Ersatz für die automatische Wiederverbindung.
Zusätzlich zu `npm test` prüft `node scripts/speaker-playback-e2e.cjs` mit Playwright
und lokal installiertem Chrome einen echten, zeitgesteuerten MP3-Stream samt zwei
simulierten Statusfehlern, einer offenen Verbindung ohne weitere Audiodaten und
einem Server-Neustart mit vorübergehendem HTTP 503; ohne Datenbankzugriff oder
Änderungen am Liveprogramm. Der Test prüft außerdem die Wiederaufnahme nach
echtem Seiten-Reload mit erlaubtem und gesperrtem Autoplay sowie einen expliziten
Stop mit anschließendem Reload.

Browser-Lautsprecher erhalten gespeicherte Zonenlautstärken zusätzlich über den
angemeldeten EventStream `/api/zones/:id/volume-events`. Der Server prüft den
gespeicherten Wert sekündlich; Änderungen aus Steuerung und Zoneneinstellungen
erreichen so auch andere laufende Browser-Sitzungen. Die normale Statusabfrage
bleibt als Rückfallebene erhalten. Verspätete Statusantworten überschreiben keine
neueren Live-Werte. Ein Web-Audio-GainNode regelt den Pegel auch auf Browsern,
die `HTMLMediaElement.volume` nicht unterstützen. Die Audiodatei und Verbindung
bleiben beim Regeln unverändert; 0 Prozent schaltet die Ausgabe stumm.
`node scripts/speaker-volume-e2e.cjs` prüft nach dem Build mit zwei getrennten
Browsersitzungen den tatsächlichen Audiopegel, Stummschaltung, einen ignorierten
Media-Volume-Setter, alte/fehlgeschlagene Statusantworten und das Beenden des
EventStreams. Der Test verwendet ausschließlich lokale Testdaten.

Webapp und Radioengine laufen derzeit im selben Railway-Service. Ein Deployment
beendet daher bestehende Stream-Verbindungen. Die Webapp behält verfügbaren
Audiopuffer und verbindet abgerissene Streams automatisch neu; lückenlose
Wiedergabe bei jedem Deployment ist damit nicht garantiert. Dafür muss die
Radioengine unabhängig von Webapp-Deployments betrieben werden. Deployment-
Überlappung allein ist für den zustandsbehafteten Scheduler kein sicherer Ersatz.

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

Die beiden Beispiele stehen im Dashboard und als `artifacts/nachrichten-mainz-de.mp3` und `artifacts/haberler-turkiye-tr.mp3` mit passenden `.txt`-Transkripten und `.json`-Metadaten bereit. Hörbeispiele werden nie automatisch ausgestrahlt. Der Morgentest arbeitet mit isolierten, anschließend entfernten Datenbank-Fixtures: Erstellung ab 06/07 Uhr, identische Tages-UUID bei Wiederholungen, kein erneuter TTS-Kauf oder Serviceabruf bei gecachter Ausgabe, sichtbare Fehler bei fehlenden Hauptnachrichten und persistiertes Ausstrahlungsprotokoll. Ein FFmpeg-Test misst synthetische Sprachintervalle in der deutschen und türkischen Mischung sowie Senderkennungen und prüft, dass dort keine Musik oder Effekte zugemischt sind.


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

Die deutsche Ausgabe ist senderneutral: Keine Nennung von Autohaus Dörrschuck, Dörşuk oder AHD Radio in Einleitung, Meldungen oder Schluss. Der kurze KI-Hinweis bleibt enthalten. Die Begrüßung wird einmal vertont und dauerhaft wiederverwendet. Frühere deutsche Senderkennungen mit Autohausnamen sind aus der Rotation genommen (`neutral-dry-v3`); neutrale Kennungen werden erst nach einer ausdrücklichen Backend-Erzeugung verwendet. Türkische Begrüßung und Autohausnennung bleiben erhalten.

Vor neuer Nachrichtenredaktion und vor dem Wetter-/Verkehrsteil wird das ElevenLabs-Guthaben schreibgeschützt geprüft (60 Sekunden Cache). Bei weniger als 1000 verbleibenden Credits und deaktivierter Mehrverbrauchsabrechnung pausieren neue Generierungen vor bezahlten Textmodellaufrufen. Der Mindestpuffer ist keine Kostengarantie für eine ganze Ausgabe. Ist der Kontostand wegen fehlender Leserechte oder vorübergehender API-Störung unbekannt, wird er nicht als null behandelt. Ein `quota_exceeded` bei der Vertonung erhält eine eigene, sichere Fehlermeldung, auch bei HTTP 401. Das Nachrichtenarchiv zeigt die letzte noch ungelöste Erstellungspanne der vergangenen 48 Stunden. Ein fehlgeschlagener Termin wird nicht nachträglich als gesendet ausgegeben; nach einer Guthabenaufladung gilt der Tagesplan mit Erstellung ab 06/07 Uhr und Ausstrahlungen um 07/21 Uhr auf Türkisch sowie stündlich 08–20 Uhr auf Deutsch.

Eine vorhandene, geprüfte deutsche Ausgabe lässt sich ohne neue Redaktion auf die gespeicherte neutrale Begrüßung umstellen. UUIDs von Hauptteil und vollständiger Ausgabe in dieser Reihenfolge übergeben; Sprach-Timeline, Quellen und ursprüngliches Sendeprotokoll bleiben nachvollziehbar:

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-neutral-refresh.ts <Hauptteil-UUID> <Ausgabe-UUID>
```

Historisches Wartungsskript für frühere Klangvarianten (nicht Teil des aktiven Programms): Eine gespeicherte türkische Ausgabe kann ohne neue TTS- oder Redaktionsaufrufe einen Nachrichtentrenner erhalten. Der Trenner wird einmal als eigene vollständige Komposition bei ElevenLabs erzeugt. Die Rohdatei und generation.json werden vor dem Mastering gespeichert, vorhandene Rohdateien lösen keinen erneuten Kauf aus. Danach wird der ganze Klang lediglich eingepegelt und wiederverwendet:

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-generate-turkish-transition.ts
python3 scripts/railway-local.py npx tsx scripts/radio-turkish-divider.ts <geprüfte-türkische-Ausgabe-ohne-Trenner-UUID> artifacts/turkish-broadcast-divider/original-elevenlabs.mp3
```

Der Archiv-Regressionstest startet ausschließlich den lokalen Produktionsbuild von Next und eine lokale Test-Authentifizierung. Er liest bestehende freigegebene Nutzer und Nachrichtenfehler, führt keine Datenbankänderungen und keine Provideraufrufe aus. Er prüft ausdrücklich die Fehlermeldung im authentifizierten Nachrichtenarchiv sowie das öffentliche JSON-Manifest und den Service Worker:

```sh
npm run build
python3 scripts/railway-local.py node scripts/radio-archive-e2e.cjs
```

Die Gestaltung des nächsten türkischen Trenners orientiert sich an zusammenhängenden professionellen Nachrichtenpaketen. Reelworld dokumentiert beispielsweise für Bloomberg ein gemeinsames Zwei-Ton-Logo und eigene Radio-Elemente für Stundenbeginn, Wetter, Verkehr und Nachrichten. Jingle Jungle dokumentiert eine eigene Klangidentität für NTV Radyo. Die öffentlichen Referenzen werden ausschließlich zur Analyse verwendet; ihre Audiodateien oder Melodien werden nicht ins Radio übernommen. Der eigene Generator-Prompt beschreibt einen vollständigen elektronischen Zwei-Sekunden-Akzent ohne Bläser, Comedy-Charakter oder folkloristische Instrumente.

- https://www.reelworld.com/brand-identity/bloomberg/
- https://www.jingle-jungle.com/tr/ntv-radyo-kimlik-muzigi

Der automatische Ablauf läuft dauerhaft im vorhandenen Railway-Hauptservice. Es ist kein laufender Desktop-Chat erforderlich: Der Recherche-/Autorenagent und der getrennte Faktenprüfer verwenden Terra, bei technischen Anbieterfehlern Haiku über Eden AI. Fehlende oder abgelehnte Hauptnachrichten werden als Fehler behandelt; eine Wetter-only-Ausgabe ersetzt keine bestandene Nachrichtenprüfung. Nach einem Serverneustart verhindert das Sendeprotokoll die erneute Ausstrahlung desselben bereits gestarteten Termins.

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-prepare-daily.ts
```

Die Musik-Erweiterung wird ausdrücklich nach erfolgreicher Nachrichtenvorbereitung gestartet. Sie erstellt bis zu sechs neue vollständige vierminütige Instrumentaltitel im bestehenden Klangspektrum als zunächst inaktive Kandidaten. Der Lauf ist auf 20.000 Credits begrenzt und hält mindestens 80.000 Credits für Nachrichten zurück. Bereits erzeugte Rohdateien werden beim Wiederholen wiederverwendet. Erst nach der Hörprüfung werden passende Kandidaten in die Rotation übernommen.


```sh
python3 scripts/railway-local.py npx tsx scripts/radio-expand-music.ts
python3 scripts/railway-local.py python3 scripts/radio-audio-review.py --music <review.json> <kurze-MP3-Ausschnitte>
python3 scripts/railway-local.py npx tsx scripts/radio-publish-music.ts <review.json>
```

Am 04.11.2026 wurden fünf neue vierminütige Titel freigegeben: Daylight, Panorama, Boulevard, Sunlit und Café. Zusammen mit dem vorhandenen Startpool sind acht Titel mit rund 29 Minuten Laufzeit aktiv. Die Audio-Prüfung vergleicht pro neuem Titel drei sieben Sekunden lange Ausschnitte (Anfang, Mitte, Ende) mit dem bestehenden Klang; sie ist keine vollständige menschliche Abhörprüfung. Die beobachtete Kontostandsänderung für die Musik-Erweiterung betrug 16.500 Credits. Verzögert gebuchte Kontostandsänderungen werden ausdrücklich nicht als bestätigter Einzelpreis eines Titels ausgewiesen.

Der zusätzliche Streamtest startet den echten Produktionsserver mit separatem temporärem Datenbankschema und Testuhr. Er prüft MP3-Pakete, die Ausgaben für 20 Uhr und 21 Uhr, die Lautstärkeblenden und das Ausstrahlungsprotokoll ohne Provideraufrufe. Außerdem prüft er den echten Hatim-Stream um 22 Uhr, den Abschluss an einer Versgrenze vor 04 Uhr und die Fortsetzung in der nächsten Nacht. Das Schema wird anschließend entfernt; Produktionstabellen bleiben unverändert:

```sh
npm run build
python3 scripts/railway-local.py npx tsx scripts/radio-daily-stream-e2e.ts
```


Türkische Meldungen verwenden ausschließlich natürliche Sprechpausen. Zur Korrektur einer vorhandenen Tagesausgabe aus gespeicherten Sprachabschnitten:

```sh
python3 scripts/railway-local.py npx tsx scripts/radio-turkish-pauses.ts <aktive-Tagesausgabe-UUID>
```

Das Skript blockiert sämtliche Netzwerk-/Provideraufrufe während des Mischens. Fehlende Sprach-Caches führen zum Abbruch statt zu einer kostenpflichtigen Neugenerierung. Der Tages-Schlüssel wird atomar auf eine neue Audio-UUID umgestellt; Originalaudio und vorhandene Ausstrahlungsprotokolle bleiben erhalten.

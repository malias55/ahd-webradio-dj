import Link from "next/link";

export const dynamic = "force-static";

export default function DocsPage() {
  return (
    <article className="prose prose-neutral max-w-none dark:prose-invert">
      <h1 className="text-3xl font-bold tracking-tight">AHD Radio DJ — Dokumentation</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Zentrale Audiosteuerung für Autohaus Dörrschuck. Server ist die Zentrale; Raspberry-Pi-Geräte sind dumme Clients.
      </p>

      <Section title="Überblick">
        <ul>
          <li><strong>Native Stream</strong>: Pro Zone wird eine Stream-URL gepflegt (Standard: AzuraCast). Der Pi spielt sie automatisch.</li>
          <li><strong>Tab-Audio</strong>: Web-App-Nutzer:in teilt einen Browser-Tab inkl. Audio → Live zur Zone gestreamt.</li>
          <li><strong>Durchsage</strong>: Mikrofon der Web-App-Nutzer:in → kurze PA-Ansage mit niedriger Latenz.</li>
          <li><strong>Automatik</strong>: Stoppt Tab-Audio/Durchsage (auch durch Tab-Schließen), fällt die Zone auf den nativen Stream zurück.</li>
        </ul>
      </Section>

      <Section title="Seiten">
        <ul>
          <li><Link href="/control" className="text-brand-600 underline">/control</Link> — Lautstärke pro Zone, Tab-Audio starten/stoppen, Durchsagen pro Zone oder an alle.</li>
          <li><Link href="/admin/devices" className="text-brand-600 underline">/admin/devices</Link> — Geräte verbinden, Zonen zuordnen, identifizieren.</li>
          <li><Link href="/admin/zones" className="text-brand-600 underline">/admin/zones</Link> — Pro Zone: Stream-URL, Quelle, Standard-Lautstärke. Zonen werden in Postgres angelegt, nicht hier.</li>
        </ul>
      </Section>

      <Section title="Raspberry-Pi-Anschluss">
        <p>Jeder Pi öffnet eine WebSocket-Verbindung:</p>
        <Code>{`URL (Produktion): wss://radio-dj.doerrschuck.de/ws
URL (lokal):      ws://<server-ip>:3000/ws`}</Code>
        <p>Pflicht-Header beim Handshake:</p>
        <Code>{`Authorization:     Bearer <DEVICE_API_KEY>
X-Device-Serial:   <CPU-Serial aus /proc/cpuinfo>
X-Device-Hostname: <os hostname>`}</Code>
        <p>
          Nach Handshake registriert der Server das Gerät automatisch (Status <code>unassigned</code>).
          Sobald in <code>/admin/devices</code> eine Zone zugewiesen wird, schickt der Server <code>play</code>-Kommandos.
        </p>
        <p>Reference-Client und systemd-Service liegen im Repo unter <code>pi-client/</code>.</p>
      </Section>

      <Section title="Kommandos (Server → Pi)">
        <Code>{`{ type: "play", url: "https://..." }
{ type: "stop" }
{ type: "pause" }
{ type: "resume" }
{ type: "volume", value: 0..100 }
{ type: "identify" }           // Test-Ton zur Identifikation`}</Code>
      </Section>

      <Section title="Ereignisse (Pi → Server)">
        <Code>{`{ type: "heartbeat" }                             // alle 30 s
{ type: "status", playing: true, source, volume } // optional
{ type: "error-report", message: "..." }`}</Code>
      </Section>

      <Section title="Zonen-Einstellungen (Postgres)">
        <p>Zonen werden direkt in der Tabelle <code>zones</code> angelegt. Pflicht ist nur <code>name</code>. Beispiel:</p>
        <Code>{`INSERT INTO zones (id, name, default_source, stream_url, volume, created_at)
VALUES (gen_random_uuid()::text, 'Neue Zone', 'azuracast',
        'https://radio.doerrschuck.de/listen/.../radio.mp3',
        80, now());`}</Code>
        <p>Die ID ist ein <code>cuid()</code>-String; jeder String mit passender Länge ist akzeptabel (oder <code>gen_random_uuid()::text</code>).</p>
      </Section>

      <Section title="Web-Audio: Tab vs. Mikrofon">
        <p>
          Beide nutzen dieselbe Pipeline (MediaRecorder → WebSocket → Server-Relay → HTTP-Live-Endpoint → mpv auf dem Pi).
          Unterschied:
        </p>
        <ul>
          <li><strong>Tab-Audio (Stream-Modus)</strong>: 250 ms Chunks, Zonen-Lautstärke. Für längere Wiedergabe.</li>
          <li><strong>Durchsage (Announce-Modus)</strong>: 120 ms Chunks (niedrige Latenz), erzwingt mindestens 80 % Lautstärke, damit die Ansage durchkommt.</li>
        </ul>
      </Section>

      <Section title="Datenbank-Konventionen">
        <p>Tabellen und Spalten in Postgres sind durchgehend <code>snake_case</code>:</p>
        <ul>
          <li><code>zones</code>(id, name, default_source, stream_url, volume, created_at)</li>
          <li><code>devices</code>(id, serial, hostname, ip, mac, model, zone_id, status, last_seen, created_at)</li>
        </ul>
        <p>Der App-Code (Prisma-Client + React) nutzt camelCase; das Mapping passiert in <code>prisma/schema.prisma</code> via <code>@map</code>/<code>@@map</code>.</p>
      </Section>

      <Section title="Umgebungsvariablen">
        <Code>{`DATABASE_URL=postgresql://...
DEVICE_API_KEY=...        # für Pi-Auth
AZURACAST_STREAM_URL=...  # optionaler Fallback

# Logto Auth (Produktion)
LOGTO_ENDPOINT=https://duxpom.logto.app/
LOGTO_APP_ID=...
LOGTO_APP_SECRET=...
LOGTO_COOKIE_SECRET=...   # 32+ Zeichen
LOGTO_BASE_URL=https://radio-dj.doerrschuck.de

# Nur lokal
SKIP_AUTH=true`}</Code>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-auto rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <code>{children}</code>
    </pre>
  );
}

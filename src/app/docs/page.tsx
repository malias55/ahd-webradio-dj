import Link from "next/link";

export const dynamic = "force-static";

export default function DocsPage() {
  return (
    <article className="prose prose-neutral max-w-none dark:prose-invert">
      <h1 className="text-3xl font-bold tracking-tight">Raspberry Pi verbinden</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Schritt-für-Schritt-Anleitung: Raspberry Pi als Lautsprecher an AHD Radio DJ anbinden.
      </p>

      <Section title="Voraussetzungen">
        <ul>
          <li>Raspberry Pi (beliebiges Modell mit Netzwerk und Audio-Ausgang)</li>
          <li>Raspberry Pi OS installiert (Lite reicht)</li>
          <li>Lautsprecher am 3,5-mm-Klinke oder HDMI</li>
          <li>SSH-Zugang zum Pi</li>
          <li>Der <code>DEVICE_API_KEY</code> aus den Railway-Umgebungsvariablen des Servers</li>
        </ul>
      </Section>

      <Section title="Schritt 1 — Software installieren">
        <p>Per SSH auf dem Pi einloggen, dann:</p>
        <Code>{`sudo apt update && sudo apt install -y mpv nodejs npm git`}</Code>
      </Section>

      <Section title="Schritt 2 — Repository klonen">
        <Code>{`sudo git clone https://github.com/malias55/ahd-webradio-dj /opt/ahd-pi-client`}</Code>
      </Section>

      <Section title="Schritt 3 — Abhängigkeiten installieren">
        <Code>{`cd /opt/ahd-pi-client/pi-client && sudo npm install`}</Code>
      </Section>

      <Section title="Schritt 4 — Konfiguration anlegen">
        <p>
          Den <code>DEVICE_API_KEY</code> aus den Railway-Umgebungsvariablen kopieren
          und in folgendem Befehl einsetzen:
        </p>
        <Code>{`sudo tee /etc/default/ahd-pi >/dev/null <<'EOF'
AHD_SERVER=wss://radio-dj.doerrschuck.de/ws
AHD_DEVICE_API_KEY=<Key hier eintragen>
EOF`}</Code>
        <p className="mt-2">
          Zum lokalen Testen stattdessen:
        </p>
        <Code>{`AHD_SERVER=ws://<server-ip>:3000/ws`}</Code>
      </Section>

      <Section title="Schritt 5 — Systemd-Service einrichten">
        <p>Service-Datei erstellen:</p>
        <Code>{`sudo tee /etc/systemd/system/ahd-pi.service >/dev/null <<'EOF'
[Unit]
Description=AHD Radio DJ Pi Client
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/ahd-pi
WorkingDirectory=/opt/ahd-pi-client/pi-client
ExecStart=/usr/bin/node client.js
Restart=always
RestartSec=3
User=admin

[Install]
WantedBy=multi-user.target
EOF`}</Code>
        <p className="mt-2">
          Falls der Pi-Benutzer nicht <code>admin</code> heißt, <code>User=admin</code> entsprechend anpassen.
        </p>
        <p className="mt-2">Service aktivieren und starten:</p>
        <Code>{`sudo systemctl enable --now ahd-pi`}</Code>
      </Section>

      <Section title="Schritt 6 — Prüfen ob es läuft">
        <Code>{`sudo systemctl status ahd-pi`}</Code>
        <p className="mt-2">Erwartete Ausgabe: <code>active (running)</code>. Detaillierte Logs:</p>
        <Code>{`sudo journalctl -u ahd-pi --no-pager -n 20`}</Code>
        <p className="mt-2">
          In den Logs sollte stehen: <code>[ahd-pi] connected as ...</code>
        </p>
      </Section>

      <Section title="Schritt 7 — Zone zuweisen">
        <p>
          Nach dem ersten Verbinden erscheint der Pi unter{" "}
          <Link href="/admin/devices" className="text-brand-600 underline">/admin/devices</Link>{" "}
          mit Status <code>unassigned</code>.
        </p>
        <ol className="mt-2 list-decimal pl-5">
          <li>Gerät in der Liste finden (Hostname wird angezeigt)</li>
          <li>Zone zuweisen</li>
          <li>Der Pi beginnt sofort mit der Wiedergabe</li>
        </ol>
      </Section>

      <Section title="Schritt 8 — Automatische Updates einrichten">
        <p>
          Der Pi kann sich täglich selbst aktualisieren.
          Folgenden Cron-Job anlegen:
        </p>
        <Code>{`sudo tee /etc/cron.daily/ahd-update >/dev/null <<'CRON'
#!/bin/bash
cd /opt/ahd-pi-client && git pull --ff-only && cd pi-client && npm install --silent && systemctl restart ahd-pi
CRON
sudo chmod +x /etc/cron.daily/ahd-update`}</Code>
        <p className="mt-2">Damit zieht der Pi jeden Tag automatisch die neueste Version und startet den Client neu.</p>
      </Section>

      <Section title="Alte Installation entfernen">
        <p>Falls vorher ein einfacher mpv-Stream-Service lief (<code>webradio.service</code>):</p>
        <Code>{`sudo systemctl disable --now webradio.service
sudo rm /etc/systemd/system/webradio.service
sudo systemctl daemon-reload`}</Code>
      </Section>

      <Section title="Audio-Ausgang wählen">
        <p>Falls kein Ton kommt:</p>
        <Code>{`# HDMI
sudo raspi-config nonint do_audio 1

# 3,5-mm-Klinke
sudo raspi-config nonint do_audio 2

# Automatisch
sudo raspi-config nonint do_audio 0`}</Code>
      </Section>

      <Section title="Unnötige Dienste deaktivieren">
        <p>Der Pi braucht kein Bluetooth oder Modem-Manager:</p>
        <Code>{`sudo systemctl disable --now bluetooth.service ModemManager.service`}</Code>
      </Section>

      <Section title="Fehlerbehebung">
        <Code>{`# Service-Status prüfen
sudo systemctl status ahd-pi

# Logs ansehen
sudo journalctl -u ahd-pi -f

# Client manuell testen
cd /opt/ahd-pi-client/pi-client
source /etc/default/ahd-pi && node client.js

# mpv direkt testen
mpv --no-video https://radio.doerrschuck.de/listen/fe4eea42-0571-4534-890e-d2a45fda8902/radio.mp3`}</Code>
      </Section>

      <Section title="Testen">
        <ul>
          <li>
            <strong>Identifizieren</strong>: In{" "}
            <Link href="/admin/devices" className="text-brand-600 underline">/admin/devices</Link>{" "}
            auf &quot;Identifizieren&quot; klicken — der Pi spielt einen Test-Ton.
          </li>
          <li>
            <strong>Lautstärke</strong>: In{" "}
            <Link href="/control" className="text-brand-600 underline">/control</Link>{" "}
            den Regler der zugewiesenen Zone bewegen.
          </li>
          <li>
            <strong>Durchsage</strong>: In{" "}
            <Link href="/control" className="text-brand-600 underline">/control</Link>{" "}
            eine Durchsage starten — der Pi unterbricht den Stream und spielt die Ansage.
          </li>
        </ul>
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

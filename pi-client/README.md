# AHD Radio DJ — Raspberry Pi Client

A minimal Node.js client that connects a Raspberry Pi to the AHD Radio DJ server and pipes commands into `mpv`.

## Connection

**URL**

| Environment | WebSocket URL |
|---|---|
| Production | `wss://radio-dj.doerrschuck.de/ws` |
| Local dev | `ws://<server-lan-ip>:3000/ws` |

**Required headers**

| Header | Value |
|---|---|
| `Authorization` | `Bearer <DEVICE_API_KEY>` — shared secret, same as server env |
| `X-Device-Serial` | Unique CPU serial (see `/proc/cpuinfo`) |
| `X-Device-Hostname` | OS hostname (display only) |

## Install on the Pi

```bash
sudo apt update
sudo apt install -y mpv nodejs npm
cd /opt && sudo git clone <repo> ahd-radio-dj-pi
cd ahd-radio-dj-pi/pi-client
sudo npm install socket.io-client
sudo cp client.js /opt/ahd-pi-client.js
sudo tee /etc/default/ahd-pi >/dev/null <<'EOF'
AHD_SERVER=wss://radio-dj.doerrschuck.de/ws
AHD_DEVICE_API_KEY=<same key as server .env>
EOF
sudo cp ahd-pi.service /etc/systemd/system/
sudo systemctl enable --now ahd-pi
```

## How it works

1. Pi opens the WebSocket with auth headers
2. Server auto-registers the device (status = `unassigned`)
3. Admin assigns the device to a zone in `/admin/devices`
4. Server pushes a `config` event; on zone playback the server sends `play` / `stop` / `volume` / `pause` / `resume` / `identify`
5. Client runs an `mpv --idle --input-ipc-server` process and drives it via the IPC socket

mpv transparently handles Icecast MP3 and WebM/Opus, so the same code path works for the AzuraCast feed and browser-broadcast live relays.

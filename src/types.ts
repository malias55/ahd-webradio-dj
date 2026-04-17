export type Zone = {
  id: string;
  name: string;
  defaultSource: "azuracast" | "silent" | "custom_url" | string;
  streamUrl: string | null;
  volume: number;
  devices?: Device[];
  liveBroadcast?: boolean;
  nowPlaying?: {
    online: boolean;
    title?: string;
    artist?: string;
    art?: string;
    elapsed?: number;
    duration?: number;
  } | null;
};

export type Device = {
  id: string;
  serial: string;
  hostname: string;
  ip: string | null;
  mac: string | null;
  model: string | null;
  zoneId: string | null;
  zone?: Zone | null;
  status: "online" | "offline" | "unassigned" | string;
  online?: boolean;
  lastSeen: string;
  createdAt: string;
};

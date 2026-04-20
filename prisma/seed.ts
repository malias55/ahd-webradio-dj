// Dummy-device seeder — DOES NOT create or modify zones.
// Zones are managed in Postgres by the operator. This script only inserts
// example Pi devices for zones that already exist.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Match by zone NAME; skip silently if a zone doesn't exist.
const DEVICE_DEFS: { serial: string; hostname: string; model: string; zoneName: string; ip: string }[] = [
  { serial: "DEMO-CPU-VK-01", hostname: "pi-verkauf-1",   model: "Pi 4B", zoneName: "Verkaufshalle Mainz", ip: "10.0.1.11" },
  { serial: "DEMO-CPU-VK-02", hostname: "pi-verkauf-2",   model: "Pi 4B", zoneName: "Verkaufshalle Mainz", ip: "10.0.1.12" },
  { serial: "DEMO-CPU-WS-01", hostname: "pi-werkstatt-1", model: "Pi 5",  zoneName: "Werkstatt Mainz",     ip: "10.0.2.11" },
  { serial: "DEMO-CPU-WS-02", hostname: "pi-werkstatt-2", model: "Pi 5",  zoneName: "Werkstatt Mainz",     ip: "10.0.2.12" },
];

const USERS = [
  { email: "info@autohaus-doerrschuck.de", name: "Admin", role: "admin" },
  { email: "kunde@autohaus-doerrschuck.de", name: "Kunde", role: "user" },
  { email: "service@autohaus-doerrschuck.de", name: "Service", role: "user" },
];

async function main() {
  let userCount = 0;
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: u,
    });
    userCount++;
  }
  console.log(`Users: ${userCount} upserted.`);

  const zones = await prisma.zone.findMany();
  const byName = new Map(zones.map((z) => [z.name, z.id]));

  let inserted = 0;
  let skipped = 0;
  for (const d of DEVICE_DEFS) {
    const zoneId = byName.get(d.zoneName);
    if (!zoneId) { skipped++; continue; }
    await prisma.device.upsert({
      where: { serial: d.serial },
      update: { hostname: d.hostname, model: d.model, ip: d.ip, zoneId, status: "offline" },
      create: { serial: d.serial, hostname: d.hostname, model: d.model, ip: d.ip, zoneId, status: "offline" },
    });
    inserted++;
  }
  console.log(`Devices: ${inserted} upserted, ${skipped} skipped (zone missing).`);
}

main().finally(() => prisma.$disconnect());

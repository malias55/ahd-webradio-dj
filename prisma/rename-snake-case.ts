// One-shot migration: rename PascalCase tables + camelCase columns to snake_case.
// Idempotent — safe to re-run; checks existence before renaming.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function tableExists(name: string) {
  const r = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS exists`,
    name
  );
  return r[0]?.exists ?? false;
}

async function columnExists(table: string, column: string) {
  const r = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS exists`,
    table, column
  );
  return r[0]?.exists ?? false;
}

async function renameTable(from: string, to: string) {
  if (await tableExists(from) && !(await tableExists(to))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${from}" RENAME TO "${to}"`);
    console.log(`renamed table ${from} -> ${to}`);
  }
}

async function renameColumn(table: string, from: string, to: string) {
  if (!(await tableExists(table))) return;
  if (await columnExists(table, from) && !(await columnExists(table, to))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`);
    console.log(`renamed ${table}.${from} -> ${to}`);
  }
}

async function main() {
  await renameTable("Zone", "zones");
  await renameTable("Device", "devices");

  await renameColumn("zones", "defaultSource", "default_source");
  await renameColumn("zones", "streamUrl", "stream_url");
  await renameColumn("zones", "createdAt", "created_at");

  await renameColumn("devices", "zoneId", "zone_id");
  await renameColumn("devices", "lastSeen", "last_seen");
  await renameColumn("devices", "createdAt", "created_at");

  // Also rename any indexes / constraints referring to old names (Postgres usually updates automatically).
  console.log("done.");
}

main().finally(() => prisma.$disconnect());

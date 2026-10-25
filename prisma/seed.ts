import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const USERS = [
  { email: "mali@autohaus-doerrschuck.de", name: "Mali", role: "admin" },
  { email: "info@autohaus-doerrschuck.de", name: "Admin", role: "admin" },
  { email: "kunde@autohaus-doerrschuck.de", name: "Kunde", role: "user" },
  { email: "service@autohaus-doerrschuck.de", name: "Service", role: "user" },
];

async function main() {
  let count = 0;
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: u,
    });
    count++;
  }
  await prisma.zone.updateMany({ where: { defaultSource: "azuracast" }, data: { defaultSource: "radio", streamUrl: null } });
  console.log(`Users: ${count} upserted.`);
}

main().finally(() => prisma.$disconnect());

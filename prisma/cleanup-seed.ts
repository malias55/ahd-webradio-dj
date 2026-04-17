import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const delZones = await prisma.zone.deleteMany({
    where: { name: { in: ["Verkauf", "Werkstatt", "Wartebereich"] } },
  });
  const delDevices = await prisma.device.deleteMany({
    where: { serial: { startsWith: "DEMO-CPU-" } },
  });
  console.log(`deleted ${delZones.count} zones, ${delDevices.count} demo devices`);
}
main().finally(() => prisma.$disconnect());

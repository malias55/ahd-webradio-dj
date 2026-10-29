import { servicePresenter } from "@/lib/radio/providers";
import { familyAssetAllowed } from "@/lib/radio/family";
import { redirect } from "next/navigation";
import { isAuthorized } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { AudioDetails, type Asset } from "@/components/RadioAudioDetails";

export const dynamic = "force-dynamic";

export default async function NewsArchive() {
  if (!(await isAuthorized())) redirect("/");
  const rows = await prisma.radioAsset.findMany({
    where: { kind: "news", createdAt: { gte: new Date(Date.now() - 14 * 86400_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, title: true, duration: true, slot: true, script: true, metadata: true, createdAt: true },
  });
  // A corrected edition replaces the same slot in this list. Historical playback
  // records still refer to the actual, unchanged file that went out at that time.
  const seen = new Set<string>();
  const assets = rows.filter(familyAssetAllowed).filter(row => {
    const key = row.slot?.toISOString() || row.id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Nachrichten</h1><p className="mt-2 text-sm text-neutral-500">Täglich um 07:00 Uhr Türkisch mit Cavit und um 08:00 Uhr Deutsch mit Elias, Wetter und Verkehr mit {servicePresenter().name}. Deutsche Ortszeit.</p></div>
    <p className="text-sm text-neutral-500">Hier können alle angemeldeten Nutzer die tatsächlich erstellten Ausgaben der letzten 14 Tage nachhören, mit Transkript und Quellen. Die Angaben zu Wetter und Verkehr beziehen sich auf den angegebenen Abrufzeitpunkt. Alle Stimmen und Ausgaben sind KI-generiert.</p>
    {!assets.length && <div className="card">Noch keine Nachrichtenausgabe gespeichert. Die nächsten Ausgaben werden automatisch vor ihrem Sendetermin erstellt.</div>}
    {assets.map(row => <section key={row.id} className="card space-y-3">
      <h2 className="font-semibold">{row.title}</h2>
      {row.slot && <p className="text-sm text-neutral-500">Ausgabe {row.slot.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" })} Uhr</p>}
      <AudioDetails asset={{ ...row, slot: row.slot?.toISOString() || null, createdAt: row.createdAt.toISOString(), metadata: row.metadata as Asset["metadata"] }} />
    </section>)}
  </div>;
}

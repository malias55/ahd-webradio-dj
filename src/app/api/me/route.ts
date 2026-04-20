import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAppUser();
  if (!user) return NextResponse.json({ authorized: false, admin: false });
  return NextResponse.json({
    authorized: true,
    admin: user.role === "admin",
    email: user.email,
    name: user.name,
  });
}

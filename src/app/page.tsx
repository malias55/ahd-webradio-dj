import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/admin";
import { LoginPage } from "@/components/LoginPage";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await getAppUser())) return <LoginPage />;

  redirect("/control");
}
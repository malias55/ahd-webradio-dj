import { doSignOut } from "@/app/actions/auth";

export function SignOutButton() {
  return (
    <form action={doSignOut}>
      <button type="submit" className="btn-ghost">Abmelden</button>
    </form>
  );
}

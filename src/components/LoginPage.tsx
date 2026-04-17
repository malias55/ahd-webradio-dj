import { LogIn, Radio } from "lucide-react";
import { doSignIn } from "@/app/actions/auth";

export function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center space-y-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 text-white">
        <Radio className="h-8 w-8" aria-hidden />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold">AHD Radio DJ</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Bitte melde dich mit deinem Doerrschuck-Account an.
        </p>
      </div>
      <form action={doSignIn} className="w-full">
        <button type="submit" className="btn-primary w-full px-6 py-3 text-base">
          <LogIn className="h-5 w-5" aria-hidden />
          Mit Logto anmelden
        </button>
      </form>
      <p className="text-xs text-neutral-500">
        Single Sign-On über <span className="font-mono">duxpom.logto.app</span>
      </p>
    </div>
  );
}

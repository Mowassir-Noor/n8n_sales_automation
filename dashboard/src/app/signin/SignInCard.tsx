"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button, Notice } from "@/components/ui";

const T = {
  title: "Texprove approvals",
  intro: "Sign in to review and approve outgoing emails.",
  google: "Sign in with Google",
  dev: "Dev sign-in",
  devHelp: "Development only: signs in as the address in DEV_LOGIN_EMAIL.",
  notAuthorised: "Not authorised. This Google account is not on the dashboard's allowlist. Ask the admin to add it, or sign in with another account.",
  genericError: "Sign-in failed. Try again.",
  configError: "Sign-in is not configured correctly on the server.",
  footer: "Only allowlisted accounts can sign in.",
};

type Providers = Record<string, { id: string; name: string; type: string }>;

function errorText(code: string | null): string | null {
  if (!code) return null;
  if (code === "AccessDenied" || code === "NotAuthorised" || code === "not_authorised") return T.notAuthorised;
  if (code === "Configuration") return T.configError;
  return T.genericError;
}

function safeCallback(v: string | null): string {
  // Only same-site relative paths.
  if (v && v.startsWith("/") && !v.startsWith("//")) return v;
  return "/";
}

export function SignInCard() {
  const sp = useSearchParams();
  const err = errorText(sp.get("error"));
  const redirectTo = safeCallback(sp.get("callbackUrl"));
  const [providers, setProviders] = useState<Providers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/auth/providers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Providers | null) => {
        if (!cancel) setProviders(p ?? {});
      })
      .catch(() => {
        if (!cancel) setProviders({});
      });
    return () => {
      cancel = true;
    };
  }, []);

  const hasDev = !!providers && "dev" in providers;
  const hasGoogle = !providers || "google" in providers;

  return (
    <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-2">
        <span className="inline-block size-6 rounded bg-accent" aria-hidden="true" />
        <h1 className="text-lg font-semibold tracking-tight">{T.title}</h1>
      </div>
      <p className="mb-5 text-muted">{T.intro}</p>
      {err ? (
        <Notice tone="danger" className="mb-4">
          {err}
        </Notice>
      ) : null}
      <div className="space-y-2">
        {hasGoogle ? (
          <Button
            variant="primary"
            className="w-full"
            busy={busy === "google"}
            onClick={() => {
              setBusy("google");
              void signIn("google", { redirectTo });
            }}
          >
            {T.google}
          </Button>
        ) : null}
        {hasDev ? (
          <>
            <Button
              className="w-full"
              busy={busy === "dev"}
              onClick={() => {
                setBusy("dev");
                void signIn("dev", { redirectTo });
              }}
            >
              {T.dev}
            </Button>
            <p className="text-xs text-muted">{T.devHelp}</p>
          </>
        ) : null}
      </div>
      <p className="mt-6 text-xs text-muted">{T.footer}</p>
    </div>
  );
}

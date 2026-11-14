"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button, Notice } from "@/components/ui";
import type { FormEvent } from "react";

const T = {
  title: "Texprove approvals",
  intro: "Sign in to review and approve outgoing emails.",
  google: "Sign in with Google",
  email: "Email",
  password: "Password",
  signIn: "Sign in",
  or: "or",
  badPassword: "Wrong email or password. After 8 wrong tries the account is locked for 15 minutes.",
  dev: "Dev sign-in",
  devHelp: "Development only: signs in as the address in DEV_LOGIN_EMAIL.",
  notAuthorised: "Not authorised. This account is not on the dashboard's allowlist. Ask the admin to add it, or sign in with another account.",
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
  const hasGoogle = !!providers && "google" in providers;
  const hasPassword = !providers || "password" in providers;
  const [pwError, setPwError] = useState<string | null>(null);

  async function submitPassword(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setBusy("password");
    setPwError(null);
    const res = await signIn("password", {
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      redirect: false,
    });
    if (!res || res.error) {
      setBusy(null);
      setPwError(res?.error === "AccessDenied" ? T.notAuthorised : T.badPassword);
      return;
    }
    window.location.href = redirectTo;
  }

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
      {hasPassword ? (
        <form onSubmit={submitPassword} className="mb-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">{T.email}</span>
            <input name="email" type="email" required autoComplete="username"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 focus:outline-2 focus:outline-accent" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">{T.password}</span>
            <input name="password" type="password" required autoComplete="current-password"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 focus:outline-2 focus:outline-accent" />
          </label>
          {pwError ? <Notice tone="danger">{pwError}</Notice> : null}
          <Button type="submit" variant="primary" className="w-full" busy={busy === "password"}>
            {T.signIn}
          </Button>
        </form>
      ) : null}
      {hasPassword && (hasGoogle || hasDev) ? <p className="mb-3 text-center text-xs text-muted">{T.or}</p> : null}
      <div className="space-y-2">
        {hasGoogle ? (
          <Button
            variant={hasPassword ? undefined : "primary"}
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

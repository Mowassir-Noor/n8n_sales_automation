"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { ReactNode } from "react";
import { useMe, useSnapshot, useStatus } from "./api";
import { fmtDuration, testModeBanner } from "./derive";
import { cx } from "./ui";

const T = {
  brand: "Texprove approvals",
  nav: [
    { href: "/", label: "Home" },
    { href: "/queue", label: "First emails" },
    { href: "/followups", label: "Follow-ups" },
    { href: "/replies", label: "Replies" },
    { href: "/leads", label: "Leads" },
    { href: "/settings", label: "Settings" },
    { href: "/suppression", label: "Suppression" },
    { href: "/social", label: "LinkedIn" },
    { href: "/activity", label: "Activity" },
  ],
  mainNav: "Main",
  signOut: "Sign out",
  roles: { admin: "Admin", approver: "Approver" } as Record<string, string>,
  stale: (age: string) =>
    `n8n is not answering. You are looking at data from ${age} ago. Approving, editing and other changes are disabled until it is back.`,
  staleNoAge: "n8n is not answering. You are looking at the last saved data. Changes are disabled until it is back.",
  loadFailed: "Could not load data from n8n. Retrying every 30 seconds.",
  headers: "The Leads tab's columns do not match what the dashboard expects. Changes are disabled until this is fixed in the sheet:",
  sendingNow: "Sending now",
  skip: "Skip to content",
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function SendingBadge({ className }: { className?: string }) {
  const status = useStatus();
  const r = status.data?.running;
  if (!r || (!r.wf3 && !r.wf5)) return null;
  const which = [r.wf3 ? "WF3" : null, r.wf5 ? "WF5" : null].filter(Boolean).join(" + ");
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent",
        className,
      )}
    >
      <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      {T.sendingNow} ({which})
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const me = useMe();
  const snap = useSnapshot();
  const data = snap.data;
  const banner = testModeBanner(data?.settings);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        {T.skip}
      </a>
      {banner.on ? (
        <div role="alert" className="bg-[#b42318] px-4 py-2 text-center text-sm font-semibold tracking-wide text-white">
          {banner.message}
        </div>
      ) : null}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block size-5 rounded bg-accent" aria-hidden="true" />
            <span className="hidden sm:inline">{T.brand}</span>
          </Link>
          <SendingBadge />
          <div className="ml-auto flex min-w-0 items-center gap-2 text-xs">
            {me.data ? (
              <>
                <span className="hidden min-w-0 truncate text-muted md:inline" title={me.data.email}>
                  {me.data.name || me.data.email}
                </span>
                <span
                  className={cx(
                    "rounded-full border px-2 py-0.5 font-medium",
                    me.data.role === "admin" ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-surface-2 text-muted",
                  )}
                  title={me.data.email}
                >
                  {T.roles[me.data.role] ?? me.data.role}
                </span>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut({ redirectTo: "/signin" })}
              className="rounded-md border border-line-strong px-2 py-1 font-medium hover:bg-surface-2"
            >
              {T.signOut}
            </button>
          </div>
        </div>
        <nav aria-label={T.mainNav} className="mx-auto max-w-[1400px] overflow-x-auto px-2">
          <ul className="flex gap-0.5">
            {T.nav.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <li key={n.href} className="shrink-0">
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "-mb-px inline-block border-b-2 px-2.5 py-2 text-sm font-medium",
                      active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      {data?.stale ? (
        <div role="status" className="border-b border-warn/30 bg-warn-soft px-4 py-2 text-center text-sm text-warn">
          {typeof data.ageSeconds === "number" ? T.stale(fmtDuration(data.ageSeconds)) : T.staleNoAge}
        </div>
      ) : null}
      {!data && snap.isError ? (
        <div role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-2 text-center text-sm text-danger">
          {T.loadFailed}
        </div>
      ) : null}
      {data && !data.headersOk ? (
        <div role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">
          <div className="mx-auto max-w-[1400px]">
            <p className="font-medium">{T.headers}</p>
            <ul className="mt-1 list-disc pl-5">
              {data.headerProblems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-4 sm:py-6">
        {children}
      </main>
    </div>
  );
}

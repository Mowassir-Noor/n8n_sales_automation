"use client";

import Link from "next/link";
import { useSnapshot, useStatus } from "@/components/api";
import { useNow } from "@/components/badges";
import { SendingBadge } from "@/components/AppShell";
import { fmtDateTimeIst, fmtRun, homeCounts, hubspotUsage, nextRun, SCHEDULE_ORDER, scheduleName } from "@/components/derive";
import { Card, Spinner, cx } from "@/components/ui";

const T = {
  title: "What needs you now",
  firstWaiting: "First emails waiting",
  followWaiting: "Follow-ups waiting",
  hot: "Hot replies not handled",
  problems: "Problems",
  failedRuns: (n: number) => (n === 1 ? "1 failed run in the last 24 h" : `${n} failed runs in the last 24 h`),
  hubspot: (p: number, at: number) => `HubSpot estimate ${p}% (pauses at ${at}%)`,
  hubspotOk: (p: number, at: number) => `HubSpot estimate ${p}% of limit (pauses at ${at}%)`,
  noProblems: "No failed runs in the last 24 h",
  statusDown: "Run status unavailable (n8n not answering)",
  open: "Open",
  next: "Next scheduled runs (Istanbul time)",
  wf4: "WF4 reply triage checks the inbox every 15 minutes.",
  loading: "Loading…",
  testSent: (n: number) => `${n} test-sent leads must be cleaned up before going live`,
  recentFailures: "Recent failed runs",
};

function Tile({
  href,
  label,
  value,
  tone,
  children,
}: {
  href: string;
  label: string;
  value: number | string;
  tone: "neutral" | "danger" | "warn" | "accent";
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "group block rounded-xl border bg-surface p-4 transition-colors hover:border-line-strong",
        tone === "danger" ? "border-danger/50" : tone === "warn" ? "border-warn/50" : "border-line",
      )}
    >
      <div className="text-sm font-medium text-muted">{label}</div>
      <div
        className={cx(
          "mt-1 text-3xl font-semibold tabular-nums",
          tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-fg",
        )}
      >
        {value}
      </div>
      {children ? <div className="mt-1 space-y-0.5 text-xs text-muted">{children}</div> : null}
    </Link>
  );
}

export function HomeView() {
  const snap = useSnapshot();
  const status = useStatus();
  const now = useNow();
  const data = snap.data;

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-muted">
        {!snap.isError ? (
          <>
            <Spinner /> {T.loading}
          </>
        ) : null}
      </div>
    );
  }

  const counts = homeCounts(data.leads, data.settings);
  const hub = hubspotUsage(data.leads, data.settings, now);
  const dayAgo = now.getTime() - 24 * 3600_000;
  const failed = (status.data?.executions ?? []).filter((e) => e.status === "error" && Date.parse(e.startedAt) >= dayAgo);
  const problemCount = failed.length + (hub.paused ? 1 : 0) + (status.isError ? 1 : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{T.title}</h1>
        <SendingBadge />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile href="/queue" label={T.firstWaiting} value={counts.firstEmailsWaiting} tone={counts.firstEmailsWaiting ? "accent" : "neutral"} />
        <Tile href="/followups" label={T.followWaiting} value={counts.followupsWaiting} tone={counts.followupsWaiting ? "accent" : "neutral"} />
        <Tile href="/replies" label={T.hot} value={counts.hotUnhandled} tone={counts.hotUnhandled ? "danger" : "neutral"} />
        <Tile href="/activity" label={T.problems} value={problemCount} tone={problemCount ? "warn" : "neutral"}>
          {status.isError ? <p>{T.statusDown}</p> : <p>{failed.length ? T.failedRuns(failed.length) : T.noProblems}</p>}
          <p className={hub.paused ? "font-medium text-warn" : undefined}>
            {hub.paused ? T.hubspot(hub.percent, hub.pauseAt) : T.hubspotOk(hub.percent, hub.pauseAt)}
          </p>
          {counts.testSent ? <p>{T.testSent(counts.testSent)}</p> : null}
        </Tile>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">{T.next}</h2>
          <ul className="divide-y divide-line">
            {SCHEDULE_ORDER.map((k) => {
              const at = nextRun(k, now);
              return (
                <li key={k} className="flex items-center justify-between gap-3 py-2">
                  <span>{scheduleName(k)}</span>
                  <span className="shrink-0 tabular-nums text-muted">{fmtRun(at, now)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">{T.wf4}</p>
        </Card>
        {failed.length ? (
          <Card className="p-4">
            <h2 className="mb-3 font-semibold">{T.recentFailures}</h2>
            <ul className="divide-y divide-line">
              {failed.slice(0, 6).map((e, i) => (
                <li key={i} className="py-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{e.workflowName}</span>
                    <span className="text-muted">{fmtDateTimeIst(e.startedAt)}</span>
                  </div>
                  {e.error ? <p className="mt-0.5 line-clamp-2 text-xs text-danger">{e.error}</p> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

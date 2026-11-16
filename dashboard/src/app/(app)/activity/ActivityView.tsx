"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { LogQuery } from "@/lib/types";
import { useLog, useSnapshot, useStatus } from "@/components/api";
import { useNow } from "@/components/badges";
import { fmtDateTimeIst, fmtDuration, hubspotUsage, pipelineCounts } from "@/components/derive";
import { Badge, Button, Card, Empty, Notice, Spinner, Tabs, TabPanel, inputClass, type Tone } from "@/components/ui";

const T = {
  title: "Activity and reports",
  tabs: { log: "Activity", runs: "Runs", pipeline: "Pipeline" },
  tabsLabel: "Activity views",
  // log
  workflow: "Workflow",
  lead: "Lead ID",
  step: "Step",
  stepHelp: "Filters the loaded page",
  from: "From",
  to: "To",
  any: "Any",
  clear: "Clear filters",
  cols: { time: "Time", workflow: "Workflow", lead: "Lead", step: "Step", reason: "Reason / by" },
  details: "Details",
  hide: "Hide",
  input: "Input (before)",
  output: "Output (after)",
  noRows: "No Log rows match.",
  page: (p: number, n: number, total: number) => `Page ${p} of ${n} · ${total} rows`,
  prev: "Newer",
  next: "Older",
  loading: "Loading…",
  // runs
  runsIntro: "The last runs of WF0–WF6 as n8n reports them.",
  runsDown: "Run status is unavailable: n8n is not answering.",
  runsEmpty: "No runs reported.",
  runCols: { wf: "Workflow", status: "Status", started: "Started", duration: "Duration", error: "Error" },
  running: "running",
  // pipeline
  byStage: "Leads by stage",
  funnel: "Funnel (all time)",
  funnelSteps: { found: "Found", researched: "Researched", drafted: "Drafted", sent: "Sent", replied: "Replied", hot: "Hot" },
  replyRate: "Reply rate",
  replyRateHelp: "Replies (not auto-replies) divided by leads with a first email sent.",
  hubspot: "HubSpot actions this month (estimate)",
  hubspotHelp: (pause: number) => `WF3's counting rule. First emails pause at ${pause}% of the limit.`,
  of: "of",
};

const WORKFLOWS = [
  "Dashboard",
  "WF0 Company discovery",
  "WF1 Lead research",
  "WF2 Compliance check and draft",
  "WF3 Send approved emails",
  "WF4 Reply triage",
  "WF5 Follow-ups",
  "WF6 Weekly report",
];

type Tab = keyof typeof T.tabs;

export function ActivityView() {
  const [tab, setTab] = useState<Tab>("log");
  return (
    <div>
      <h1 className="mb-3 text-xl font-semibold tracking-tight">{T.title}</h1>
      <Tabs idBase="act" label={T.tabsLabel} value={tab} onChange={setTab} items={(Object.keys(T.tabs) as Tab[]).map((k) => ({ key: k, label: T.tabs[k] }))} />
      <TabPanel idBase="act" value={tab} className="mt-4">
        {tab === "log" ? <LogTab /> : tab === "runs" ? <RunsTab /> : <PipelineTab />}
      </TabPanel>
    </div>
  );
}

// ---- Log ------------------------------------------------------------------------

function LogTab() {
  const [workflow, setWorkflow] = useState("");
  const [leadId, setLeadId] = useState("");
  const [step, setStep] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const pageSize = 50;
  const q: LogQuery = { workflow: workflow || undefined, leadId: leadId.trim() || undefined, from: from || undefined, to: to || undefined, page, pageSize };
  const log = useLog(q);
  const rows = useMemo(() => {
    const s = step.trim().toLowerCase();
    return (log.data?.rows ?? []).filter((r) => !s || r.Step.toLowerCase().includes(s));
  }, [log.data, step]);
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / pageSize)) : 1;
  // Workflow names as they appear in the sheet, plus the known ones.
  const seen = useMemo(
    () => [...new Set([...WORKFLOWS, ...(log.data?.rows ?? []).map((r) => r.Workflow).filter(Boolean)])].sort((a, b) => a.localeCompare(b)),
    [log.data],
  );
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
    setOpen(null);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6 md:items-end">
        <div className="col-span-2">
          <label htmlFor="log-wf" className="mb-1 block text-xs font-medium text-muted">
            {T.workflow}
          </label>
          <select id="log-wf" className={inputClass} value={workflow} onChange={(e) => reset(() => setWorkflow(e.target.value))}>
            <option value="">{T.any}</option>
            {seen.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="log-lead" className="mb-1 block text-xs font-medium text-muted">
            {T.lead}
          </label>
          <input id="log-lead" className={inputClass} value={leadId} placeholder="L013" onChange={(e) => reset(() => setLeadId(e.target.value))} />
        </div>
        <div>
          <label htmlFor="log-step" className="mb-1 block text-xs font-medium text-muted" title={T.stepHelp}>
            {T.step}
          </label>
          <input id="log-step" className={inputClass} value={step} onChange={(e) => setStep(e.target.value)} />
        </div>
        <div>
          <label htmlFor="log-from" className="mb-1 block text-xs font-medium text-muted">
            {T.from}
          </label>
          <input id="log-from" type="date" className={inputClass} value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        </div>
        <div>
          <label htmlFor="log-to" className="mb-1 block text-xs font-medium text-muted">
            {T.to}
          </label>
          <input id="log-to" type="date" className={inputClass} value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{log.data ? T.page(page, pages, log.data.total) : log.isLoading ? T.loading : ""}</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              reset(() => {
                setWorkflow("");
                setLeadId("");
                setStep("");
                setFrom("");
                setTo("");
              })
            }
          >
            {T.clear}
          </Button>
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {T.prev}
          </Button>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {T.next}
          </Button>
        </div>
      </div>
      {log.isError ? <Notice tone="danger">{(log.error as Error).message}</Notice> : null}
      {log.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty>{T.noRows}</Empty>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.time}</th>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.workflow}</th>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.lead}</th>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.step}</th>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.reason}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{T.details}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={`${r.row_number ?? ""}-${i}`}>
                  <tr className="border-t border-line align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{fmtDateTimeIst(r.Timestamp)}</td>
                    <td className="px-3 py-2">
                      {r.Workflow === "Dashboard" ? <Badge tone="accent">Dashboard</Badge> : r.Workflow}
                    </td>
                    <td className="px-3 py-2">
                      {r["Lead ID"] ? (
                        <Link href={`/leads/${encodeURIComponent(r["Lead ID"])}`} className="text-accent hover:underline">
                          {r["Lead ID"]}
                        </Link>
                      ) : null}{" "}
                      <span className="text-muted">{r.Company}</span>
                    </td>
                    <td className="px-3 py-2 font-medium">{r.Step}</td>
                    <td className="max-w-xs px-3 py-2 break-words text-muted">{r.Reason}</td>
                    <td className="px-3 py-2 text-right">
                      {r.Input || r.Output ? (
                        <Button size="sm" variant="ghost" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                          {open === i ? T.hide : T.details}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                  {open === i ? (
                    <tr className="bg-surface-2">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="grid gap-2 md:grid-cols-2">
                          <div>
                            <div className="text-xs font-medium text-muted">{T.input}</div>
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{r.Input}</pre>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-muted">{T.output}</div>
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{r.Output}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Runs -----------------------------------------------------------------------

function statusTone(s: string): Tone {
  if (s === "success") return "ok";
  if (s === "error" || s === "crashed") return "danger";
  if (s === "running" || s === "waiting") return "accent";
  return "neutral";
}

function RunsTab() {
  const status = useStatus();
  const now = useNow(10_000);
  if (status.isLoading) return <Spinner />;
  if (status.isError || !status.data) return <Notice tone="danger">{T.runsDown}</Notice>;
  const ex = [...status.data.executions].sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  return (
    <div className="space-y-3">
      <p className="text-muted">{T.runsIntro}</p>
      {ex.length === 0 ? (
        <Empty>{T.runsEmpty}</Empty>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                {Object.values(T.runCols).map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ex.map((e, i) => {
                const start = Date.parse(e.startedAt);
                const stop = e.stoppedAt ? Date.parse(e.stoppedAt) : now.getTime();
                return (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-medium">{e.workflowName}</td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{fmtDateTimeIst(e.startedAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted">
                      {isNaN(start) ? "" : fmtDuration((stop - start) / 1000)}
                      {!e.stoppedAt ? ` (${T.running})` : ""}
                    </td>
                    <td className="max-w-md px-3 py-2 break-words text-danger">{e.error ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Pipeline -------------------------------------------------------------------

function Bar({ label, value, max, tone = "accent", suffix }: { label: string; value: number; max: number; tone?: "accent" | "warn" | "danger"; suffix?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <div className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-2 text-sm">
      <span className="truncate" title={label}>
        {label}
      </span>
      <div className="h-3 overflow-hidden rounded-full bg-surface-2" role="presentation">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-right tabular-nums text-muted">
        {value}
        {suffix ?? ""}
      </span>
    </div>
  );
}

function PipelineTab() {
  const snap = useSnapshot();
  const now = useNow(60_000);
  const data = snap.data;
  if (!data) return <Spinner />;
  const leads = data.leads;
  const counts = pipelineCounts(leads).filter((c) => c.count > 0);
  const maxCount = Math.max(1, ...counts.map((c) => c.count));
  const has = (v: string) => (v || "").trim() !== "";
  const funnel = [
    { key: "found", n: leads.length },
    { key: "researched", n: leads.filter((l) => !["New", "Research failed", ""].includes(l.Stage.trim())).length },
    { key: "drafted", n: leads.filter((l) => has(l["Draft Body"])).length },
    { key: "sent", n: leads.filter((l) => has(l["Sent At"])).length },
    { key: "replied", n: leads.filter((l) => has(l["Reply Category"]) && l["Reply Category"] !== "Auto-reply").length },
    { key: "hot", n: leads.filter((l) => l["Reply Category"] === "Hot").length },
  ] as const;
  const sent = funnel[3].n;
  const replied = funnel[4].n;
  const rate = sent ? Math.round((replied / sent) * 1000) / 10 : 0;
  const hub = hubspotUsage(leads, data.settings, now);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{T.byStage}</h2>
        <div className="space-y-1.5">
          {counts.map((c) => (
            <Bar key={c.stage} label={c.stage} value={c.count} max={maxCount} />
          ))}
        </div>
      </Card>
      <div className="space-y-4">
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">{T.funnel}</h2>
          <div className="space-y-1.5">
            {funnel.map((f) => (
              <Bar key={f.key} label={T.funnelSteps[f.key]} value={f.n} max={Math.max(1, funnel[0].n)} tone={f.key === "hot" ? "danger" : "accent"} />
            ))}
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-sm text-muted">{T.replyRate}</span>
            <span className="text-2xl font-semibold tabular-nums">{rate}%</span>
            <span className="text-xs text-muted">
              ({replied}/{sent})
            </span>
          </div>
          <p className="text-xs text-muted">{T.replyRateHelp}</p>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">{T.hubspot}</h2>
          <div className="relative h-4 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full ${hub.paused ? "bg-danger" : hub.percent >= hub.pauseAt * 0.8 ? "bg-warn" : "bg-accent"}`}
              style={{ width: `${Math.min(100, hub.percent)}%` }}
            />
            <div className="absolute inset-y-0 w-0.5 bg-fg/60" style={{ left: `${Math.min(100, hub.pauseAt)}%` }} aria-hidden="true" />
          </div>
          <p className="mt-2 text-sm">
            <span className="font-semibold tabular-nums">{hub.used}</span> {T.of} {hub.limit} ({hub.percent}%)
          </p>
          <p className="text-xs text-muted">{T.hubspotHelp(hub.pauseAt)}</p>
        </Card>
      </div>
    </div>
  );
}

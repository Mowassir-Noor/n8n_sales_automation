"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { LeadHeader, LeadRow, LogRow } from "@/lib/types";
import { useLog, useSnapshot } from "@/components/api";
import { CategoryBadge, ComplianceBadge, StageBadge } from "@/components/badges";
import { findLead, firstEmailTab, fmtDateTimeIst, isFollowupPending, isHot } from "@/components/derive";
import { Button, Card, DataList, Empty, Notice, Spinner } from "@/components/ui";

const T = {
  back: "All leads",
  loading: "Loading lead…",
  notFound: (id: string) => `No lead with ID ${id}.`,
  groups: {
    company: "Company",
    contact: "Contact",
    research: "Research",
    first: "First email",
    sending: "Sending and follow-ups",
    replies: "Replies and status",
  },
  timeline: "Timeline (Log tab)",
  timelineEmpty: "No Log rows for this lead.",
  more: "Load older",
  inQueue: "Open in first-email queue",
  inFollowups: "Open in follow-ups",
  inReplies: "Open in replies",
  staleDraft: "Not sent: the lead replied while this follow-up was waiting.",
  input: "Input",
  output: "Output",
  by: "Reason",
};

const GROUPS: Array<[keyof typeof T.groups, LeadHeader[]]> = [
  ["company", ["Lead ID", "Company", "Website", "Country", "Segment", "Source URL", "Source Date", "Confidence"]],
  ["contact", ["Contact Name", "Contact Title", "Email", "LinkedIn", "Language"]],
  ["research", ["Research Notes", "Personalisation Hook"]],
  ["first", ["Compliance Status", "Compliance Notes", "Subject", "Draft Body", "Draft Body EN", "Approved", "Nil Notes"]],
  ["sending", ["Stage", "Sent At", "Gmail Thread ID", "Follow-up Count", "Next Follow-up Date", "Follow-up Draft"]],
  ["replies", ["Reply Category", "Reply Summary", "Hot Handled", "Opt-out", "HubSpot Contact ID", "Last Updated"]],
];

function value(lead: LeadRow, h: LeadHeader): ReactNode {
  const v = lead[h] ?? "";
  if (!v) return "";
  if (h === "Compliance Status") return <ComplianceBadge status={v} />;
  if (h === "Stage") return <StageBadge stage={v} />;
  if (h === "Reply Category") return <CategoryBadge category={v} />;
  if ((h === "Website" || h === "LinkedIn" || h === "Source URL") && /^https?:\/\//i.test(v.trim()))
    return (
      <a href={v.trim()} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">
        {v}
      </a>
    );
  if (h === "Sent At" || h === "Last Updated") return `${fmtDateTimeIst(v)}  (${v})`;
  return v;
}

export function LeadDetail({ id }: { id: string }) {
  const snap = useSnapshot();
  const data = snap.data;
  if (!data) return <div className="flex items-center gap-2 text-muted">{snap.isError ? null : <><Spinner /> {T.loading}</>}</div>;
  const lead = findLead(data.leads, id);

  return (
    <div className="space-y-4">
      <Link href="/leads" className="text-sm font-medium text-accent hover:underline">
        ← {T.back}
      </Link>
      {!lead ? (
        <Empty>{T.notFound(id)}</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{lead.Company}</h1>
              <p className="text-muted">
                {lead["Lead ID"]} · {lead["Contact Name"] || "-"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StageBadge stage={lead.Stage} />
              {firstEmailTab(lead) ? (
                <Link className="text-sm font-medium text-accent hover:underline" href={`/queue?id=${encodeURIComponent(lead["Lead ID"])}`}>
                  {T.inQueue}
                </Link>
              ) : null}
              {isFollowupPending(lead) ? (
                <Link className="text-sm font-medium text-accent hover:underline" href="/followups">
                  {T.inFollowups}
                </Link>
              ) : null}
              {lead["Reply Category"] ? (
                <Link className="text-sm font-medium text-accent hover:underline" href="/replies">
                  {T.inReplies}
                </Link>
              ) : null}
              {isHot(lead) ? <CategoryBadge category="Hot" /> : null}
            </div>
          </div>
          {lead.Stage.startsWith("Replied") && lead["Follow-up Draft"].trim() ? <Notice tone="warn">{T.staleDraft}</Notice> : null}
          <div className="grid gap-4 xl:grid-cols-2">
            {GROUPS.map(([g, headers]) => (
              <Card key={g} className="p-4">
                <h2 className="mb-3 font-semibold">{T.groups[g]}</h2>
                <DataList items={headers.map((h) => [h, value(lead, h)] as [string, ReactNode])} />
              </Card>
            ))}
          </div>
          <Timeline leadId={lead["Lead ID"]} />
        </>
      )}
    </div>
  );
}

function Timeline({ leadId }: { leadId: string }) {
  const [pageSize, setPageSize] = useState(50);
  const log = useLog({ leadId, pageSize });
  const rows: LogRow[] = log.data?.rows ?? [];
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-semibold">{T.timeline}</h2>
      {log.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-muted">{T.timelineEmpty}</p>
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-4">
          {rows.map((r, i) => (
            <li key={`${r.Timestamp}-${i}`} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden="true" />
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{r.Step}</span>
                <span className="text-muted">{r.Workflow}</span>
                <span className="text-xs text-muted">{fmtDateTimeIst(r.Timestamp)}</span>
              </div>
              {r.Reason ? <p className="text-xs text-muted">{r.Reason}</p> : null}
              {r.Input || r.Output ? (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-muted">
                    {T.input} / {T.output}
                  </summary>
                  {r.Input ? <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-2">{r.Input}</pre> : null}
                  {r.Output ? <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-2">{r.Output}</pre> : null}
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {log.data && log.data.total > rows.length ? (
        <Button size="sm" className="mt-3" busy={log.isFetching} onClick={() => setPageSize((n) => Math.min(200, n + 50))}>
          {T.more}
        </Button>
      ) : null}
    </Card>
  );
}

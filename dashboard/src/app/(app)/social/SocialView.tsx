"use client";

import { useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SocialRow, SocialWriteRequest } from "@/lib/types";
import { hashText } from "@shared/email";
import { newRequestId, postJson, SNAPSHOT_KEY, useSnapshot, type SnapshotResponse } from "@/components/api";
import { useWriteGuard } from "@/components/actions";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Empty, Spinner, inputClass, type Tone } from "@/components/ui";

const T = {
  title: "LinkedIn drafts",
  subtitle: "WF6 adds three drafts every Monday. Nothing posts automatically: approve, post by hand, then mark Posted.",
  loading: "Loading…",
  empty: "No LinkedIn drafts yet.",
  week: "Week",
  approve: "Approve",
  reject: "Reject",
  notes: "Nil Notes",
  saveNote: "Save note",
  posted: "Mark posted",
  unposted: "Not posted",
  isPosted: "Posted",
  saved: "Saved.",
  copy: "Copy text",
  copied: "Copied.",
  pending: "Pending",
};

function approvedTone(v: string): Tone {
  return v === "Yes" ? "ok" : v === "No" ? "danger" : v === "Edit" ? "warn" : "neutral";
}

export function SocialView() {
  const snap = useSnapshot();
  const data = snap.data;
  const rows = useMemo(() => [...(data?.social ?? [])].sort((a, b) => (b.Week || "").localeCompare(a.Week || "") || (a.row_number ?? 0) - (b.row_number ?? 0)), [data]);
  if (!data) return <div className="flex items-center gap-2 text-muted">{snap.isError ? null : <><Spinner /> {T.loading}</>}</div>;
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">{T.title}</h1>
        <p className="text-muted">{T.subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <Empty>{T.empty}</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((r, i) => (
            <SocialCard key={r.row_number ?? i} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function SocialCard({ row }: { row: SocialRow }) {
  const ids = useId();
  const guard = useWriteGuard();
  const fb = useFeedback();
  const qc = useQueryClient();
  const [note, setNote] = useState(row["Nil Notes"]);
  const [busy, setBusy] = useState<string | null>(null);

  const write = async (key: string, data: SocialWriteRequest["data"]) => {
    if (row.row_number == null) return;
    setBusy(key);
    try {
      const req: SocialWriteRequest = {
        rowNumber: row.row_number,
        expect: { Week: row.Week, Topic: row.Topic, draftHash: hashText(row.Draft) },
        data,
        requestId: newRequestId(),
      };
      const res = await postJson("/api/social", req);
      if (fb.handle(res, { success: T.saved, mine: row as unknown as Record<string, unknown> })) {
        const updated = res.body.row as SocialRow | undefined;
        if (updated) {
          qc.setQueryData<SnapshotResponse>(SNAPSHOT_KEY, (old) =>
            old ? { ...old, social: old.social.map((s) => (s.row_number === row.row_number ? { ...s, ...updated } : s)) } : old,
          );
        }
        void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      }
    } finally {
      setBusy(null);
    }
  };

  const off = guard.disabled || row.row_number == null;
  const posted = row.Posted === "Yes";
  return (
    <article className="flex flex-col rounded-lg border border-line bg-surface" aria-labelledby={`${ids}-h`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            {T.week} {row.Week}
          </p>
          <h2 id={`${ids}-h`} className="font-semibold">
            {row.Topic}
          </h2>
        </div>
        <div className="flex gap-1.5">
          <Badge tone={approvedTone(row.Approved)}>{row.Approved || T.pending}</Badge>
          <Badge tone={posted ? "ok" : "neutral"}>{posted ? T.isPosted : T.unposted}</Badge>
        </div>
      </div>
      <pre className="flex-1 whitespace-pre-wrap break-words px-4 py-3 font-sans text-sm leading-relaxed">{row.Draft}</pre>
      <div className="space-y-2 border-t border-line px-4 py-3">
        <label htmlFor={`${ids}-n`} className="block text-xs font-medium">
          {T.notes}
        </label>
        <div className="flex gap-2">
          <input id={`${ids}-n`} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="md" disabled={off || note === row["Nil Notes"]} busy={busy === "note"} onClick={() => void write("note", { "Nil Notes": note })}>
            {T.saveNote}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="ok" disabled={off || row.Approved === "Yes"} busy={busy === "yes"} onClick={() => void write("yes", { Approved: "Yes" })}>
            {T.approve}
          </Button>
          <Button variant="danger" disabled={off || row.Approved === "No"} busy={busy === "no"} onClick={() => void write("no", { Approved: "No" })}>
            {T.reject}
          </Button>
          <Button
            disabled={off}
            busy={busy === "posted"}
            onClick={() => void write("posted", { Posted: posted ? "No" : "Yes" })}
          >
            {posted ? T.unposted : T.posted}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(row.Draft).then(() => fb.handle({ status: 200, body: { ok: true } }, { success: T.copied }));
            }}
          >
            {T.copy}
          </Button>
        </div>
      </div>
    </article>
  );
}

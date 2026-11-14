"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SuppressionRow, SuppressionWriteRequest } from "@/lib/types";
import { isSuppressed } from "@shared/email";
import { newRequestId, postJson, SNAPSHOT_KEY, useSnapshot, type SnapshotResponse } from "@/components/api";
import { useRole, useWriteGuard } from "@/components/actions";
import { useFeedback } from "@/components/feedback";
import { Button, Card, Dialog, Empty, Field, Notice, Spinner, inputClass, cx } from "@/components/ui";

const T = {
  title: "Suppression",
  subtitle: "Addresses and domains that must never be contacted. WF2 blocks them, WF3 refuses to send, WF5 skips their follow-ups.",
  loading: "Loading…",
  search: "Search",
  searchPh: "Email, domain or reason",
  addTitle: "Add to Suppression",
  kind: "Type",
  email: "Email address",
  domain: "Domain",
  value: { email: "Email address", domain: "Domain (e.g. example.com)" },
  reason: "Reason",
  reasonPh: "e.g. İYS ret notice, bounce, asked not to be contacted",
  add: "Add",
  added: "Added to Suppression.",
  invalidEmail: "Enter one valid email address.",
  invalidDomain: "Enter a domain like example.com (no @, no http).",
  already: "Already suppressed by an existing row.",
  matches: (n: number) =>
    n === 0 ? "No existing leads match." : n === 1 ? "1 existing lead matches and will be blocked." : `${n} existing leads match and will be blocked.`,
  cols: { email: "Email", domain: "Domain", reason: "Reason", date: "Date" },
  remove: "Remove",
  removeTitle: "Remove this Suppression row?",
  removeBody: "Workflows may contact this address or domain again. The reason is written to the Log.",
  removeReason: "Reason for removing",
  removed: "Row removed.",
  cancel: "Cancel",
  empty: "No rows.",
  count: (n: number) => `${n} rows`,
  adminOnly: "Only the admin can remove rows.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function SuppressionView() {
  const snap = useSnapshot();
  const data = snap.data;
  const guard = useWriteGuard();
  const { isAdmin } = useRole();
  const fb = useFeedback();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"email" | "domain">("email");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<SuppressionRow | null>(null);
  const [removeReason, setRemoveReason] = useState("");

  const rows = useMemo(() => data?.suppression ?? [], [data]);
  const leads = useMemo(() => data?.leads ?? [], [data]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const xs = n ? rows.filter((r) => [r.Email, r.Domain, r.Reason].some((v) => (v || "").toLowerCase().includes(n))) : rows;
    return [...xs].sort((a, b) => (b.Date || "").localeCompare(a.Date || ""));
  }, [rows, q]);

  const v = value.trim().toLowerCase().replace(/^@/, "");
  const valid = kind === "email" ? EMAIL_RE.test(v) : DOMAIN_RE.test(v);
  const probe: SuppressionRow[] = valid ? [kind === "email" ? { Email: v, Domain: "", Reason: "", Date: "" } : { Email: "", Domain: v, Reason: "", Date: "" }] : [];
  const matchCount = valid ? leads.filter((l) => l.Email && isSuppressed(l.Email, probe)).length : 0;
  const already = valid && kind === "email" ? isSuppressed(v, rows) : valid && rows.some((r) => (r.Domain || "").toLowerCase().replace(/^@/, "") === v);

  const applySuppression = (list: unknown) => {
    if (!Array.isArray(list)) return void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    qc.setQueryData<SnapshotResponse>(SNAPSHOT_KEY, (old) => (old ? { ...old, suppression: list as SuppressionRow[] } : old));
    void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
  };

  const add = async () => {
    setBusy(true);
    try {
      const req: SuppressionWriteRequest = {
        action: "add",
        data: kind === "email" ? { Email: v, Reason: reason.trim() } : { Domain: v, Reason: reason.trim() },
        requestId: newRequestId(),
      };
      const res = await postJson("/api/suppression", req);
      if (fb.handle(res, { success: T.added })) {
        applySuppression(res.body.suppression);
        setValue("");
        setReason("");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing || removing.row_number == null) return;
    setBusy(true);
    try {
      const req: SuppressionWriteRequest = {
        action: "remove",
        rowNumber: removing.row_number,
        expect: { Email: removing.Email, Domain: removing.Domain },
        reason: removeReason.trim(),
        requestId: newRequestId(),
      };
      const res = await postJson("/api/suppression", req);
      if (fb.handle(res, { success: T.removed, mine: removing as unknown as Record<string, unknown> })) {
        applySuppression(res.body.suppression);
        setRemoving(null);
        setRemoveReason("");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="flex items-center gap-2 text-muted">{snap.isError ? null : <><Spinner /> {T.loading}</>}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{T.title}</h1>
        <p className="text-muted">{T.subtitle}</p>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{T.addTitle}</h2>
        <form
          className="grid gap-3 md:grid-cols-[auto_1fr_1fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && reason.trim() && !guard.disabled) void add();
          }}
        >
          <fieldset>
            <legend className="mb-1 text-xs font-medium">{T.kind}</legend>
            <div className="flex gap-1">
              {(["email", "domain"] as const).map((k) => (
                <label
                  key={k}
                  className={cx(
                    "cursor-pointer rounded-md border px-2.5 py-1.5 text-sm",
                    kind === k ? "border-accent bg-accent-soft text-accent" : "border-line-strong",
                  )}
                >
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                  {k === "email" ? T.email : T.domain}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={T.value[kind]} htmlFor="sup-value" error={value.trim() && !valid ? (kind === "email" ? T.invalidEmail : T.invalidDomain) : undefined}>
            <input id="sup-value" className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={T.reason} htmlFor="sup-reason">
            <input id="sup-reason" className={inputClass} value={reason} placeholder={T.reasonPh} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" busy={busy && !removing} disabled={!valid || !reason.trim() || guard.disabled}>
            {T.add}
          </Button>
        </form>
        {valid ? (
          <div className="mt-3 space-y-2">
            {already ? <Notice tone="neutral">{T.already}</Notice> : null}
            <Notice tone={matchCount ? "warn" : "neutral"}>{T.matches(matchCount)}</Notice>
          </div>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="w-full max-w-sm">
          <label htmlFor="sup-q" className="mb-1 block text-xs font-medium text-muted">
            {T.search}
          </label>
          <input id="sup-q" type="search" className={inputClass} placeholder={T.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="text-sm text-muted">
          {T.count(filtered.length)}
          {!isAdmin ? ` · ${T.adminOnly}` : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty>{T.empty}</Empty>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.email}</th>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.domain}</th>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.reason}</th>
                <th scope="col" className="px-3 py-2 font-medium">{T.cols.date}</th>
                {isAdmin ? <th scope="col" className="px-3 py-2"><span className="sr-only">{T.remove}</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.row_number ?? i}`} className="border-t border-line">
                  <td className="px-3 py-2 break-all">{r.Email}</td>
                  <td className="px-3 py-2">{r.Domain}</td>
                  <td className="px-3 py-2 text-muted">{r.Reason}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{r.Date}</td>
                  {isAdmin ? (
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="danger" disabled={guard.disabled || r.row_number == null} onClick={() => setRemoving(r)}>
                        {T.remove}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={T.removeTitle}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>{T.cancel}</Button>
            <Button variant="danger" busy={busy} disabled={!removeReason.trim() || guard.disabled} onClick={() => void remove()}>
              {T.remove}
            </Button>
          </>
        }
      >
        {removing ? (
          <>
            <p className="mb-2 font-medium">{removing.Email || removing.Domain}</p>
            <Notice tone="warn" className="mb-3">
              {T.removeBody}
            </Notice>
            <Field label={T.removeReason} htmlFor="sup-rm-reason">
              <input id="sup-rm-reason" data-autofocus className={inputClass} value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} />
            </Field>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TARGET_COUNTRIES, parseCountries, type Settings, type SettingsHeader, type SettingsWriteRequest } from "@/lib/types";
import { settingsFieldAccess, validateSettingsValues } from "@/lib/rules";
import { newRequestId, postJson, SNAPSHOT_KEY, useSnapshot, type SnapshotResponse } from "@/components/api";
import { useRole, useWriteGuard } from "@/components/actions";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, Dialog, Notice, Spinner, inputClass, cx } from "@/components/ui";
import { GoLive } from "./GoLive";

const T = {
  title: "Settings",
  subtitle: "The single Settings row of the sheet. Every workflow reads it at the start of its next run.",
  loading: "Loading settings…",
  save: "Review changes",
  reset: "Discard changes",
  noChanges: "No changes",
  changed: (n: number) => (n === 1 ? "1 field changed" : `${n} fields changed`),
  locked: { readonly: "Read-only", admin: "Admin only" },
  readonlyWhy: "Must match the enabled nodes in n8n; change it there, then in the sheet.",
  adminWhy: "Only the admin can change this.",
  sheetOnly: "Change it in the sheet itself.",
  notUsed: "Not used",
  diffTitle: "Save these changes?",
  field: "Field",
  before: "Before",
  after: "After",
  empty: "(empty)",
  affects: "What this affects",
  typed: (w: string) => `This changes admin-only switches. Type ${w} to confirm.`,
  typedWord: "CONFIRM",
  confirmSave: "Save",
  cancel: "Cancel",
  saved: "Settings saved.",
  testClear: "Test Email can only be cleared with the Go-live flow below.",
  errors: "Fix these first:",
};

type FieldDef = { key: SettingsHeader; help: string; multiline?: boolean; affects?: string; notUsed?: boolean; countries?: boolean };
type Group = { title: string; fields: FieldDef[] };

const SIG_AFFECTS =
  "Changes the signature of drafts written from the next WF2 run (weekdays 09:00). Existing drafts keep the old text; edit them by hand if needed.";

const GROUPS: Group[] = [
  {
    title: "Target countries",
    fields: [
      {
        key: "Target Countries",
        countries: true,
        help: "Countries the weekly company search (WF0, Mondays) looks in. Each picked country runs its own six segment searches, so every extra country adds about $3 of API cost a week. Turkish companies get Turkish emails; companies in the other countries get English emails. Unticking a country only stops new searches there: leads already found keep going.",
        affects: "WF0 searches the new country list from its next run (Monday 07:00).",
      },
    ],
  },
  {
    title: "Sender and signature",
    fields: [
      { key: "Sender Name", help: "Full name the emails come from. The preview finds the signature by this exact line.", affects: SIG_AFFECTS },
      { key: "Sender Title", help: "Their title, printed under the name.", affects: SIG_AFFECTS },
      { key: "Company Legal Name", help: "Registered company name, printed in the signature.", affects: SIG_AFFECTS },
      { key: "Company Address", help: "Postal address printed in the signature.", multiline: true, affects: SIG_AFFECTS },
      { key: "Company Website", help: "WF2 puts it on the last line of the signature and the draft check requires it.", affects: SIG_AFFECTS },
      { key: "Opt-out TR", help: "Turkish opt-out sentence appended to every email.", multiline: true, affects: SIG_AFFECTS },
      { key: "Opt-out EN", help: "English opt-out sentence.", multiline: true, affects: SIG_AFFECTS },
    ],
  },
  {
    title: "Notifications",
    fields: [
      { key: "Nil Email", help: "Manager's address for approval requests, Hot alerts, summaries and reports.", affects: "Notifications from the next workflow run go to the new address." },
      { key: "Nil Telegram Chat ID", help: "Manager's numeric Telegram chat ID (they must press Start on the bot once).", affects: "Telegram alerts from the next run go to this chat." },
      { key: "Sheet URL", help: "Link to this sheet, included in notifications." },
    ],
  },
  {
    title: "Sending and test mode",
    fields: [
      {
        key: "Test Email",
        help: "Test mode switch. While it holds an address, WF3 sends every first email (and creates the HubSpot contact) to that address instead of the lead. Clear it only with Go live.",
        affects: "All emails from the next run go to the new test address.",
      },
      { key: "Mail Provider", help: "SMTP sends with the SMTP nodes and reads replies over IMAP; Gmail (also when empty) uses the Gmail nodes. The matching nodes must be enabled in n8n." },
      { key: "SMTP From", help: "Sender used by the SMTP nodes. Only read when Mail Provider is SMTP." },
    ],
  },
  {
    title: "HubSpot quota",
    fields: [
      { key: "HubSpot Monthly Limit", help: "Optional, default 3000.", affects: "WF3's quota gate uses the new limit from its next run." },
      {
        key: "HubSpot Pause Percent",
        help: "Optional, default 80. WF3 pauses first emails when the estimated month's actions reach this share of the limit.",
        affects: "WF3's quota gate uses the new share from its next run.",
      },
      { key: "HubSpot Owner ID", help: "Not read by the current workflows (left from an earlier HubSpot-task build).", notUsed: true },
    ],
  },
  {
    title: "Inbox seed",
    fields: [
      {
        key: "Seed Email",
        help: "Inbox-placement check. Every 'Seed Every' first emails, a copy of the last one goes here so you can see whether it lands in Inbox or Spam. Empty = off.",
        affects: "WF3 sends seed copies to the new address from its next run.",
      },
      { key: "Seed Every", help: "How many first emails between copies, default 12.", affects: "WF3 uses the new interval from its next run." },
    ],
  },
  {
    title: "Not used",
    fields: [
      { key: "Nil WhatsApp", help: "Not read any more (WhatsApp nodes removed). Left in place so column letters don't move.", notUsed: true },
      { key: "WhatsApp Phone Number ID", help: "Not read any more.", notUsed: true },
    ],
  },
];

const ALL_FIELDS = GROUPS.flatMap((g) => g.fields);
const ADMIN_TYPED: SettingsHeader[] = ["Test Email", "HubSpot Monthly Limit", "HubSpot Pause Percent", "Seed Email", "Seed Every"];
const ADMIN_ONLY_FIELDS: SettingsHeader[] = [...ADMIN_TYPED, "Target Countries"];

function toggleCountry(value: string, country: string, on: boolean): string {
  const picked = new Set<string>(parseCountries(value).list);
  if (on) picked.add(country);
  else picked.delete(country);
  return TARGET_COUNTRIES.filter((c) => picked.has(c)).join(", ");
}

export function SettingsView() {
  const snap = useSnapshot();
  const data = snap.data;
  const { role, isAdmin } = useRole();
  const guard = useWriteGuard();
  const fb = useFeedback();
  const qc = useQueryClient();

  const [form, setForm] = useState<Partial<Settings>>({});
  const [base, setBase] = useState<Settings | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);

  // Start from the sheet's values; keep the user's edits while polling refreshes the snapshot.
  if (data?.settings && !base) {
    setBase(data.settings);
    setForm(data.settings);
  }

  const changed = useMemo(() => {
    if (!base) return [] as SettingsHeader[];
    return ALL_FIELDS.map((f) => f.key).filter((k) => (form[k] ?? "") !== (base[k] ?? ""));
  }, [form, base]);

  const errors = useMemo(() => {
    const d: Partial<Settings> = {};
    for (const k of changed) d[k] = form[k] ?? "";
    const errs = validateSettingsValues(d);
    if (changed.includes("Test Email") && !(form["Test Email"] ?? "").trim()) errs.push(T.testClear);
    return errs;
  }, [changed, form]);

  if (!data || !base || !role) {
    return <div className="flex items-center gap-2 text-muted">{snap.isError ? null : <><Spinner /> {T.loading}</>}</div>;
  }

  // The sheet changed under us (another user or a hand edit) for a field we did not touch: show it.
  const sheet = data.settings;
  const needTyped = changed.some((k) => ADMIN_TYPED.includes(k));

  const save = async () => {
    setSaving(true);
    try {
      const req: SettingsWriteRequest = {
        expect: Object.fromEntries(changed.map((k) => [k, base[k] ?? ""])),
        data: Object.fromEntries(changed.map((k) => [k, (form[k] ?? "").trim()])),
        requestId: newRequestId(),
      };
      const res = await postJson("/api/settings", req);
      const ok = fb.handle(res, { success: T.saved, mine: base as unknown as Record<string, unknown> });
      if (ok) {
        const next = (res.body.settings as Settings | undefined) ?? ({ ...base, ...req.data } as Settings);
        qc.setQueryData<SnapshotResponse>(SNAPSHOT_KEY, (old) => (old ? { ...old, settings: next } : old));
        void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
        setBase(next);
        setForm(next);
        setDiffOpen(false);
        setTyped("");
      } else if (res.status === 409) {
        setDiffOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const affects = [...new Set(changed.map((k) => ALL_FIELDS.find((f) => f.key === k)?.affects).filter(Boolean))] as string[];

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{T.title}</h1>
        <p className="text-muted">{T.subtitle}</p>
      </div>

      {GROUPS.map((g) => (
        <Card key={g.title} className="p-4">
          <h2 className="mb-3 font-semibold">{g.title}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {g.fields.map((f) => {
              const access = settingsFieldAccess(f.key, role);
              const isAdminField = ADMIN_ONLY_FIELDS.includes(f.key);
              const readOnly = access === "readonly" || guard.disabled;
              const id = `set-${f.key.replace(/\W+/g, "-")}`;
              const isChanged = changed.includes(f.key);
              const sheetMoved = !isChanged && (sheet[f.key] ?? "") !== (base[f.key] ?? "");
              const common = {
                id,
                value: form[f.key] ?? "",
                readOnly,
                "aria-describedby": `${id}-help`,
                onChange: (e: { target: { value: string } }) => setForm((s) => ({ ...s, [f.key]: e.target.value })),
                className: cx(inputClass, readOnly && "bg-surface-2 text-muted", isChanged && "border-accent ring-1 ring-accent/30"),
              };
              return (
                <div key={f.key} className={cx("space-y-1", f.multiline && "md:col-span-2")}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label htmlFor={id} className="text-xs font-medium">
                      {f.key}
                    </label>
                    {f.notUsed ? <Badge>{T.notUsed}</Badge> : null}
                    {access === "readonly" && !isAdminField ? <Badge>{T.locked.readonly}</Badge> : null}
                    {isAdminField ? <Badge tone={isAdmin ? "warn" : "neutral"}>{T.locked.admin}</Badge> : null}
                  </div>
                  {f.countries ? (
                    <div
                      id={id}
                      role="group"
                      aria-describedby={`${id}-help`}
                      className={cx("flex flex-wrap gap-2 rounded-md border border-line p-2", isChanged && "border-accent ring-1 ring-accent/30")}
                    >
                      {TARGET_COUNTRIES.map((c) => {
                        const value = form[f.key] ?? "";
                        const on = parseCountries(value).list.includes(c) || (c === "Turkey" && !value.trim());
                        return (
                          <label
                            key={c}
                            className={cx(
                              "flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-sm",
                              on && "border-accent bg-accent/10",
                              readOnly && "cursor-not-allowed opacity-70",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={readOnly}
                              onChange={(e) =>
                                setForm((s) => ({ ...s, [f.key]: toggleCountry((s[f.key] ?? "").trim() || "Turkey", c, e.target.checked) }))
                              }
                            />
                            {c}
                          </label>
                        );
                      })}
                    </div>
                  ) : f.multiline ? (
                    <textarea rows={3} {...common} />
                  ) : (
                    <input type="text" {...common} />
                  )}
                  <p id={`${id}-help`} className="text-xs text-muted">
                    {f.help}
                    {f.key === "Mail Provider" || f.key === "SMTP From" ? ` ${T.readonlyWhy}` : ""}
                    {f.key === "Sheet URL" ? ` ${T.sheetOnly}` : ""}
                    {access === "readonly" && isAdminField ? ` ${T.adminWhy}` : ""}
                  </p>
                  {sheetMoved ? (
                    <p className="text-xs text-warn">
                      Changed in the sheet since you opened this page: now “{sheet[f.key] || T.empty}”. Reload to use it.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      {isAdmin ? <GoLive /> : null}

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-2">
          <span className="text-sm text-muted">{changed.length ? T.changed(changed.length) : T.noChanges}</span>
          <div className="flex gap-2">
            <Button disabled={!changed.length} onClick={() => setForm(base)}>
              {T.reset}
            </Button>
            <Button variant="primary" disabled={!changed.length || errors.length > 0 || guard.disabled} onClick={() => setDiffOpen(true)}>
              {T.save}
            </Button>
          </div>
        </div>
        {changed.length && errors.length ? (
          <div className="mx-auto max-w-[1400px] px-4 pb-2">
            <Notice tone="danger">
              {T.errors} {errors.join(" ")}
            </Notice>
          </div>
        ) : null}
      </div>

      <Dialog
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        title={T.diffTitle}
        wide
        footer={
          <>
            <Button onClick={() => setDiffOpen(false)}>{T.cancel}</Button>
            <Button
              variant="primary"
              busy={saving}
              disabled={guard.disabled || (needTyped && typed.trim() !== T.typedWord)}
              onClick={() => void save()}
            >
              {T.confirmSave}
            </Button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="w-40 border-b border-line py-1 pr-2 font-medium">{T.field}</th>
                <th className="border-b border-line py-1 pr-2 font-medium">{T.before}</th>
                <th className="border-b border-line py-1 font-medium">{T.after}</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((k) => (
                <tr key={k}>
                  <td className="border-b border-line py-1.5 pr-2 align-top font-medium">{k}</td>
                  <td className="border-b border-line py-1.5 pr-2 align-top whitespace-pre-wrap break-words text-danger line-through decoration-danger/50">
                    {base[k] || T.empty}
                  </td>
                  <td className="border-b border-line py-1.5 align-top whitespace-pre-wrap break-words text-ok">{(form[k] ?? "").trim() || T.empty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {affects.length ? (
          <div className="mt-3">
            <h3 className="mb-1 text-sm font-semibold">{T.affects}</h3>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {affects.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {needTyped ? (
          <div className="mt-3 space-y-1">
            <label htmlFor="typed-confirm" className="block text-sm">
              {T.typed(T.typedWord)}
            </label>
            <input id="typed-confirm" className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

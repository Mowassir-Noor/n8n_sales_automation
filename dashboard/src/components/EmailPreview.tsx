"use client";

import { useMemo, useState } from "react";
import type { LeadRow, Settings } from "@/lib/types";
import { buildHtml, recipientFor } from "@shared/email";
import { cx } from "./ui";

const T = {
  from: "From",
  to: "To",
  subject: "Subject",
  desktop: "Desktop 600 px",
  phone: "Phone 375 px",
  width: "Preview width",
  frameTitle: "Email preview",
  realAddress: "lead's real address, not used in test mode",
  note: "The preview cannot show Gmail's own link styling, and Gmail may turn plain addresses into links.",
  noFrom: "(SMTP From not set)",
  noSubject: "(no subject)",
  noRecipient: "(no address)",
  plainNote: "This is exactly the plain-text part of the email.",
};

/** Mail-client style header: From, To (test address with the real one struck through), Subject. */
export function MailHeader({ lead, settings, subject }: { lead: Partial<LeadRow>; settings: Settings; subject: string }) {
  const r = recipientFor(lead, settings);
  return (
    <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 border-b border-line px-3 py-2 text-sm">
      <dt className="text-muted">{T.from}</dt>
      <dd className="min-w-0 break-words">{settings["SMTP From"] || <span className="text-muted">{T.noFrom}</span>}</dd>
      <dt className="text-muted">{T.to}</dt>
      <dd className="min-w-0 break-words">
        {r.to ? <span className={r.testMode ? "font-semibold text-danger" : undefined}>{r.to}</span> : <span className="text-muted">{T.noRecipient}</span>}
        {r.testMode && r.realTo && r.realTo !== r.to ? (
          <>
            {" "}
            <s className="text-muted" title={T.realAddress} aria-label={`${r.realTo} (${T.realAddress})`}>
              {r.realTo}
            </s>
          </>
        ) : null}
      </dd>
      <dt className="text-muted">{T.subject}</dt>
      <dd className="min-w-0 break-words font-medium">{subject || <span className="text-muted">{T.noSubject}</span>}</dd>
    </dl>
  );
}

function srcDoc(html: string): string {
  // The draft HTML only ever lives inside this sandboxed frame (sandbox="" => no scripts, no forms, unique origin).
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#fff;}body{padding:16px;}</style></head><body>${html}</body></html>`;
}

export function HtmlPreview({ body, settings, height = 560 }: { body: string; settings: Settings; height?: number }) {
  const [width, setWidth] = useState<600 | 375>(600);
  const html = useMemo(() => buildHtml(body, settings), [body, settings]);
  return (
    <div>
      <div role="group" aria-label={T.width} className="flex gap-1 px-3 py-2">
        {([600, 375] as const).map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={width === w}
            onClick={() => setWidth(w)}
            className={cx(
              "rounded-md border px-2 py-1 text-xs font-medium",
              width === w ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg",
            )}
          >
            {w === 600 ? T.desktop : T.phone}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto bg-surface-2 px-3 py-3">
        <iframe
          title={T.frameTitle}
          sandbox=""
          srcDoc={srcDoc(html)}
          style={{ width, height, maxWidth: "none" }}
          className="mx-auto block rounded border border-line bg-white"
        />
      </div>
      <p className="px-3 py-2 text-xs text-muted">{T.note}</p>
    </div>
  );
}

export function PlainTextPreview({ text, note = T.plainNote }: { text: string; note?: string }) {
  return (
    <div>
      <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[13px] leading-relaxed">{text}</pre>
      {note ? <p className="px-3 pb-2 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

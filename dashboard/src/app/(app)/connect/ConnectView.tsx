"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/components/api";
import { Button, Card, Notice, PageHeader, Spinner, inputClass } from "@/components/ui";

const T = {
  title: "Connect Claude",
  subtitle: "Use this dashboard by chatting with Claude: ask what is waiting, read an email, approve or reject it.",
  urlLabel: "Your connector URL",
  show: "Show",
  hide: "Hide",
  copy: "Copy",
  copied: "Copied",
  secret: "This URL works like a password and is only for you. Do not share it or paste it anywhere except Claude.",
  role: (r: string) =>
    r === "admin"
      ? "Claude can do everything you can do here as admin, including Settings and going live."
      : "Claude can do what you can do here as approver: approve, edit, reject, follow-ups, replies and normal settings.",
  stepsTitle: "How to add it to Claude",
  steps: [
    "Copy the URL above.",
    "In Claude (claude.ai or the desktop app), open Settings → Connectors and choose Add custom connector.",
    "Name it Texprove dashboard, paste the URL, and save. No sign-in is needed.",
    "In a chat, turn the connector on from the tools menu, then ask things like: What is waiting for approval? Show me L041's email. Approve it.",
  ],
  safety:
    "Every change Claude makes goes through the same checks as the buttons here and is written to the Log. Claude is told to show you the email before approving and never to switch off Test Email unless you clearly ask to go live.",
  lost: "If this URL leaks, tell the admin: changing MCP_SECRET on the server replaces everyone's URL.",
  failed: "Could not load your connector URL.",
};

type ConnectorResponse = { url: string; email: string; role: string };

export function ConnectView() {
  const q = useQuery({ queryKey: ["connector"], queryFn: () => getJson<ConnectorResponse>("/api/connector"), staleTime: Infinity });
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!q.data) return;
    try {
      await navigator.clipboard.writeText(q.data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShown(true);
    }
  };

  const masked = q.data ? q.data.url.replace(/\/api\/mcp\/.+$/, "/api/mcp/" + "•".repeat(24)) : "";

  return (
    <div className="max-w-2xl">
      <PageHeader title={T.title} subtitle={T.subtitle} />
      <Card className="p-4">
        <label htmlFor="connector-url" className="mb-1 block text-sm font-medium">
          {T.urlLabel}
        </label>
        {q.isLoading ? (
          <Spinner />
        ) : q.isError || !q.data ? (
          <Notice tone="danger">{(q.error as Error)?.message || T.failed}</Notice>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <input
                id="connector-url"
                readOnly
                value={shown ? q.data.url : masked}
                className={inputClass + " min-w-0 flex-1 font-mono text-xs"}
                onFocus={(e) => shown && e.currentTarget.select()}
              />
              <Button onClick={() => setShown((s) => !s)}>{shown ? T.hide : T.show}</Button>
              <Button variant="primary" onClick={copy}>
                {copied ? T.copied : T.copy}
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted">{T.role(q.data.role)}</p>
            <Notice tone="warn" className="mt-3">
              {T.secret}
            </Notice>
          </>
        )}
      </Card>
      <Card className="mt-4 p-4">
        <h2 className="mb-2 font-semibold">{T.stepsTitle}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {T.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-muted">{T.safety}</p>
        <p className="mt-2 text-sm text-muted">{T.lost}</p>
      </Card>
    </div>
  );
}

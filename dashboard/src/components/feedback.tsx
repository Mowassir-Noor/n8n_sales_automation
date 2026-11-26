"use client";

// Turns write responses (200/409/422/403/5xx) into UI: toasts, the "changed since you opened it"
// dialog with the current row, and the list of validation errors.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Button, Dialog } from "./ui";
import { useToast } from "./toast";
import { useRefreshSnapshot, type PostResult } from "./api";

const T = {
  conflictTitle: "This changed since you opened it",
  conflictIntro: "Someone (or a workflow) changed this row after you loaded it. Nothing was written. Check the current values, then reload and try again.",
  field: "Field",
  youSaw: "You saw",
  now: "Now",
  reload: "Reload",
  close: "Close",
  errorsTitle: "The change was not saved",
  errorsIntro: "The server refused it for these reasons:",
  forbidden: "Your role is not allowed to do this.",
  network: "The server could not be reached. Try again.",
  failed: "Something went wrong on the server",
  rowGone: "The row no longer exists.",
};

const CONFLICT_FIELDS = [
  "Stage",
  "Approved",
  "Compliance Status",
  "Subject",
  "Draft Body",
  "Follow-up Draft",
  "Nil Notes",
  "Reply Category",
  "Opt-out",
  "Last Updated",
] as const;

type Conflict = { message: string; current: Record<string, unknown> | null; mine?: Record<string, unknown> };

type FeedbackApi = {
  /** Returns true when the write succeeded (2xx and ok). */
  handle: (res: PostResult, opts?: { success?: string; mine?: Record<string, unknown> }) => boolean;
};

const FeedbackContext = createContext<FeedbackApi>({ handle: () => false });

export function useFeedback(): FeedbackApi {
  return useContext(FeedbackContext);
}

function errText(body: Record<string, unknown>): string | undefined {
  return typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : undefined;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const refresh = useRefreshSnapshot();
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [reloading, setReloading] = useState(false);

  const handle = useCallback<FeedbackApi["handle"]>(
    (res, opts) => {
      const b = res.body ?? {};
      if (res.status >= 200 && res.status < 300 && b.ok !== false) {
        if (opts?.success) toast.show(opts.success, "ok");
        return true;
      }
      if (res.status === 409) {
        setConflict({
          message: typeof b.message === "string" ? b.message : "",
          current: (b.row as Record<string, unknown> | null) ?? null,
          mine: opts?.mine,
        });
        return false;
      }
      if (res.status === 422 && Array.isArray(b.errors)) {
        setErrors((b.errors as unknown[]).map(String));
        return false;
      }
      if (res.status === 403) {
        toast.show(errText(b) ?? T.forbidden, "danger");
        return false;
      }
      if (res.status === 0) {
        toast.show(T.network, "danger");
        return false;
      }
      toast.show(`${T.failed}: ${errText(b) ?? `HTTP ${res.status}`}`, "danger");
      return false;
    },
    [toast],
  );

  const api = useMemo(() => ({ handle }), [handle]);

  const onReload = async () => {
    setReloading(true);
    try {
      await refresh();
    } finally {
      setReloading(false);
      setConflict(null);
    }
  };

  const fields = conflict
    ? CONFLICT_FIELDS.filter((f) => (conflict.current && f in conflict.current) || (conflict.mine && f in conflict.mine))
    : [];

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <Dialog
        open={!!conflict}
        onClose={() => setConflict(null)}
        title={T.conflictTitle}
        wide
        footer={
          <>
            <Button onClick={() => setConflict(null)}>{T.close}</Button>
            <Button variant="primary" busy={reloading} onClick={onReload}>
              {T.reload}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-muted">{T.conflictIntro}</p>
        {conflict?.message ? <p className="mb-3">{conflict.message}</p> : null}
        {conflict && !conflict.current ? <p className="mb-3 text-danger">{T.rowGone}</p> : null}
        {conflict && conflict.current ? (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="w-32 border-b border-line py-1 pr-2 font-medium">{T.field}</th>
                  {conflict.mine ? <th className="border-b border-line py-1 pr-2 font-medium">{T.youSaw}</th> : null}
                  <th className="border-b border-line py-1 font-medium">{T.now}</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const mine = String(conflict.mine?.[f] ?? "");
                  const cur = String(conflict.current?.[f] ?? "");
                  const changed = conflict.mine ? mine !== cur : false;
                  return (
                    <tr key={f} className={changed ? "bg-warn-soft" : undefined}>
                      <td className="border-b border-line py-1 pr-2 align-top font-medium">{f}</td>
                      {conflict.mine ? (
                        <td className="border-b border-line py-1 pr-2 align-top whitespace-pre-wrap break-words">{mine}</td>
                      ) : null}
                      <td className="border-b border-line py-1 align-top whitespace-pre-wrap break-words">{cur}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={!!errors}
        onClose={() => setErrors(null)}
        title={T.errorsTitle}
        footer={<Button onClick={() => setErrors(null)}>{T.close}</Button>}
      >
        <p className="mb-2 text-muted">{T.errorsIntro}</p>
        <ul className="list-disc space-y-1 pl-5">
          {(errors ?? []).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </Dialog>
    </FeedbackContext.Provider>
  );
}


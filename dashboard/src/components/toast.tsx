"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

type ToastTone = "ok" | "danger" | "neutral";
type ToastItem = { id: number; text: string; tone: ToastTone };
type ToastApi = { show: (text: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const show = useCallback((text: string, tone: ToastTone = "neutral") => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-3), { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "danger" ? 8000 : 4000);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto max-w-md rounded-lg border px-4 py-2 text-sm shadow-lg",
              t.tone === "ok" && "border-ok/40 bg-ok-soft text-ok",
              t.tone === "danger" && "border-danger/40 bg-danger-soft text-danger",
              t.tone === "neutral" && "border-line bg-surface text-fg",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

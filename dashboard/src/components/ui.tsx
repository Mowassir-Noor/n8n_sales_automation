"use client";

// Small UI kit: Button, Badge, Tabs, Dialog (native <dialog>), Field helpers, Card, Spinner.
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type KeyboardEvent,
} from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "ok";
type ButtonSize = "sm" | "md";

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent",
  ok: "bg-ok text-white border border-transparent hover:opacity-90",
  secondary: "bg-surface text-fg border border-line-strong hover:bg-surface-2",
  danger: "bg-surface text-danger border border-danger/60 hover:bg-danger-soft",
  ghost: "bg-transparent text-fg border border-transparent hover:bg-surface-2",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", busy, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variantClass[variant],
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";
const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-accent/30",
  ok: "bg-ok-soft text-ok border-ok/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  danger: "bg-danger-soft text-danger border-danger/30",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-muted">{children}</div>;
}

export function Notice({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", toneClass[tone], className)}>
      {children}
    </div>
  );
}

// ---- Tabs ---------------------------------------------------------------

export type TabItem<K extends string> = { key: K; label: ReactNode; count?: number };

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
  className,
  size = "md",
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  idBase: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = items.findIndex((i) => i.key === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      e.stopPropagation();
      onChange(items[next].key);
      refs.current[items[next].key]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className={cx("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {items.map((it) => {
        const selected = it.key === value;
        return (
          <button
            key={it.key}
            ref={(el) => {
              refs.current[it.key] = el;
            }}
            role="tab"
            type="button"
            id={`${idBase}-tab-${it.key}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(it.key)}
            className={cx(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 font-medium whitespace-nowrap",
              size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm",
              selected ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {it.label}
            {typeof it.count === "number" ? (
              <span className={cx("rounded-full px-1.5 text-[11px] leading-4", selected ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>
                {it.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, value, children, className }: { idBase: string; value: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}

// ---- Dialog -------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        "m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-line bg-surface p-0 shadow-2xl",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open ? (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-3">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

// ---- Form helpers ---------------------------------------------------------

export const inputClass =
  "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-muted/70 disabled:bg-surface-2 disabled:text-muted";

export function Field({
  label,
  help,
  children,
  htmlFor,
  error,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  htmlFor: string;
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {help ? <p className="text-xs text-muted">{help}</p> : null}
    </div>
  );
}

/** Label/value rows for read-only data. Values are always rendered as text. */
export function DataList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(8rem,max-content)_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs font-medium text-muted sm:pt-0.5">{k}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words">{v === "" || v == null ? <span className="text-muted">-</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

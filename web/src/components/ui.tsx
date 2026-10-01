import { clsx } from "clsx";
import { ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

export { clsx as cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        size === "sm" && "h-9 px-3.5 text-sm rounded-xl",
        size === "md" && "h-12 px-5 text-[15px]",
        size === "lg" && "h-14 px-6 text-base",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
        variant === "secondary" && "bg-surface-2 text-ink hover:bg-line",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2",
        variant === "danger" && "bg-bad-soft text-bad hover:brightness-95",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx("rounded-3xl bg-surface p-5 shadow-card", className)}>
      {children}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-ink-3">{hint}</p>}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

export function Input({ className, suffix, ...rest }: InputHTMLAttributes<HTMLInputElement> & { suffix?: string }) {
  const input = (
    <input
      {...rest}
      className={clsx(
        "h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[16px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent focus:ring-4 focus:ring-accent/15",
        suffix && "pr-14",
        className,
      )}
    />
  );
  if (!suffix) return input;
  return (
    <div className="relative">
      {input}
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-ink-3">{suffix}</span>
    </div>
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={clsx("h-12 w-full appearance-none rounded-2xl border border-line bg-surface px-4 text-[16px] text-ink outline-none focus:border-accent focus:ring-4 focus:ring-accent/15", className)}
    >
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("flex cursor-pointer items-center justify-between gap-4 py-3", disabled && "opacity-50")}>
      <span>
        <span className="block text-[15px] font-medium text-ink">{label}</span>
        {description && <span className="block text-sm text-ink-3">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-7 w-12 shrink-0 rounded-full transition", checked ? "bg-accent" : "bg-line")}
      >
        <span className={clsx("absolute top-0.5 size-6 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; className?: string }) {
  return (
    <div className={clsx("flex gap-1 rounded-2xl bg-surface-2 p-1", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition",
            value === o.value ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Panneau glissant du bas (mobile) / fenêtre centrée (desktop). */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] bg-surface shadow-2xl sm:max-w-lg sm:rounded-[28px]">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-surface-2 text-ink-2" aria-label="Fermer">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="safe-bottom border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function PageHeader({ title, subtitle, action, back }: { title: string; subtitle?: ReactNode; action?: ReactNode; back?: string }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        {back && (
          <Link to={back} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-accent">
            <ChevronRight className="size-4 rotate-180" /> Retour
          </Link>
        )}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function ListLink({ to, icon, label, description, onClick, danger }: { to?: string; icon: ReactNode; label: string; description?: string; onClick?: () => void; danger?: boolean }) {
  const inner = (
    <>
      <span className={clsx("grid size-10 shrink-0 place-items-center rounded-2xl", danger ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={clsx("block text-[15px] font-medium", danger ? "text-bad" : "text-ink")}>{label}</span>
        {description && <span className="block truncate text-sm text-ink-3">{description}</span>}
      </span>
      {!danger && <ChevronRight className="size-5 text-ink-3" />}
    </>
  );
  const cls = "flex w-full items-center gap-3.5 px-4 py-3 text-left transition hover:bg-surface-2";
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx("grid place-items-center py-16 text-ink-3", className)}>
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

export function Notice({ tone = "info", children, icon }: { tone?: "info" | "ok" | "warn" | "bad"; children: ReactNode; icon?: ReactNode }) {
  return (
    <div
      className={clsx(
        "flex items-start gap-3 rounded-2xl px-4 py-3 text-sm",
        tone === "info" && "bg-info-soft text-info",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad",
      )}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-3xl bg-surface-2 text-ink-3">{icon}</div>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-ink-3">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">{children}</h2>
      {action}
    </div>
  );
}

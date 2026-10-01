import { BarChart3, CalendarDays, Clock3, Home, UserRound } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { cx } from "./ui";
import { useDashboard } from "@/lib/hooks";

const NAV = [
  { to: "/", label: "Accueil", icon: Home, end: true },
  { to: "/pointer", label: "Pointer", icon: Clock3 },
  { to: "/calendrier", label: "Calendrier", icon: CalendarDays },
  { to: "/statistiques", label: "Stats", icon: BarChart3 },
  { to: "/profil", label: "Profil", icon: UserRound },
];

export function AppShell() {
  const { data } = useDashboard();
  const status = data?.status;
  return (
    <div className="min-h-dvh lg:flex">
      {/* Barre latérale (grand écran) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line px-4 py-6 lg:flex">
        <div className="mb-8 flex items-center gap-2.5 px-3">
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="text-lg font-bold tracking-tight">Pointeuse</span>
        </div>
        <nav className="space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx("flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium transition", isActive ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")
              }
            >
              <Icon className="size-5" />
              {label === "Stats" ? "Statistiques" : label}
              {to === "/pointer" && status && status !== "off" && <StatusDot status={status} className="ml-auto" />}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="safe-top mx-auto w-full max-w-3xl flex-1 px-4 pb-32 pt-6 sm:px-6 lg:pb-12 lg:pt-10">
        <Outlet />
      </main>

      {/* Barre de navigation (mobile) */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 backdrop-blur-xl lg:hidden" aria-label="Navigation principale">
        <div className="mx-auto flex max-w-md justify-around px-2 pt-1.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cx("relative flex w-16 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition", isActive ? "text-accent" : "text-ink-3")}
            >
              <Icon className="size-6" strokeWidth={1.8} />
              {label}
              {to === "/pointer" && status && status !== "off" && <StatusDot status={status} className="absolute right-4 top-1" />}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function StatusDot({ status, className }: { status: "working" | "break" | "off"; className?: string }) {
  return <span className={cx("size-2.5 rounded-full", status === "working" ? "pulse-dot bg-ok text-ok" : status === "break" ? "bg-warn" : "bg-ink-3", className)} />;
}

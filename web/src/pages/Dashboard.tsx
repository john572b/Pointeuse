import { AlertTriangle, ChevronRight, Clock3, Wallet } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import { formatDuration, formatMoney } from "@shared/format";
import { useDashboard, useUser } from "@/lib/hooks";
import { capitalize, hhmm, shortDate } from "@/lib/dates";
import { Card, EmptyState, SectionTitle, Sheet, Spinner, cx } from "@/components/ui";
import { ClockActions, StatusPill, StatusSentence, useLive } from "@/components/Clock";
import { PayBreakdown } from "@/components/PayBreakdown";
import { ProgressRing } from "@/components/ProgressRing";

export function Dashboard() {
  const user = useUser();
  const { data: d, isLoading, error } = useDashboard();
  const live = useLive(d);
  const [payOpen, setPayOpen] = useState(false);

  if (isLoading) return <Spinner />;
  if (error || !d || !live) return <EmptyState icon={<AlertTriangle />} title="Impossible de charger vos données" text={(error as Error)?.message} />;

  const zone = user.timezone;
  const goalMs = d.week.goalHours * 3_600_000;
  const goalPct = goalMs > 0 ? live.week / goalMs : 0;
  const hour = DateTime.now().setZone(zone).hour;
  const hello = hour >= 18 || hour < 5 ? "Bonsoir" : "Bonjour";
  const maxDay = Math.max(d.todaySummary.dailyHours * 3_600_000, ...d.week.days.map((x) => x.workedMs), 1);

  return (
    <div className="animate-in space-y-4">
      <header className="mb-2 px-1">
        <p className="text-[15px] text-ink-3">{capitalize(DateTime.now().setZone(zone).setLocale("fr").toFormat("cccc d LLLL"))}</p>
        <h1 className="text-[28px] font-bold tracking-tight">
          {hello} {user.firstName} 👋
        </h1>
      </header>

      {/* Carte principale : statut + temps du jour + action */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <StatusPill status={d.status} />
          <span className="text-sm text-ink-3">
            <StatusSentence d={d} live={live} zone={zone} />
          </span>
        </div>
        <div className="my-7 text-center">
          <p className="tabular text-[64px] font-bold leading-none tracking-tight">{formatDuration(live.today)}</p>
          <p className="mt-2 text-[15px] text-ink-3">travaillées aujourd'hui</p>
        </div>
        <div className="mb-6 grid grid-cols-3 divide-x divide-line rounded-2xl bg-surface-2 py-3 text-center">
          <Mini label="Début" value={d.todayStart ? hhmm(d.todayStart, zone) : "—"} />
          <Mini label="Pause" value={formatDuration(live.todayBreak)} />
          <Mini label="Heures sup." value={formatDuration(live.overtime)} highlight={live.overtime > 0} />
        </div>
        <ClockActions d={d} />
      </Card>

      {d.anomalies.length > 0 && (
        <Link to={`/calendrier?jour=${d.anomalies[0].date}`} className="flex items-center gap-3 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">
          <AlertTriangle className="size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <b className="font-semibold">{shortDate(d.anomalies[0].date)}</b> — {d.anomalies[0].message}
            {d.anomalies.length > 1 && <span className="opacity-80"> (+{d.anomalies.length - 1} autre{d.anomalies.length > 2 ? "s" : ""})</span>}
          </span>
          <ChevronRight className="size-4 shrink-0" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <p className="text-sm font-medium text-ink-3">Cette semaine</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="tabular whitespace-nowrap text-[22px] font-bold tracking-tight">{formatDuration(live.week)}</p>
            <ProgressRing value={goalPct} size={44} stroke={5}>
              <span className="tabular text-[10px] font-semibold">{Math.min(999, Math.round(goalPct * 100))}%</span>
            </ProgressRing>
          </div>
          <p className="mt-2 text-xs text-ink-3">Objectif {d.week.goalHours} h</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-ink-3">Ce mois</p>
          <p className="tabular mt-3 whitespace-nowrap text-[22px] font-bold tracking-tight">{formatDuration(live.month)}</p>
          <p className="mt-2 text-xs text-ink-3">
            {d.month.daysWorked} jour{d.month.daysWorked > 1 ? "s" : ""} · {formatDuration(d.month.overtimeMs)} sup.
          </p>
        </Card>
      </div>

      <button onClick={() => setPayOpen(true)} className="block w-full text-left">
        <Card className="flex items-center gap-4 transition hover:brightness-[0.99]">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Wallet className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink-3">Salaire estimé du mois</p>
            <p className="tabular text-[26px] font-bold tracking-tight">{formatMoney(d.month.amountCents, user.currency)}</p>
          </div>
          <span className="flex items-center text-sm font-medium text-accent">
            Détail <ChevronRight className="size-4" />
          </span>
        </Card>
      </button>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-ink-3">Semaine en cours</p>
          <Link to="/statistiques" className="text-sm font-medium text-accent">
            Statistiques
          </Link>
        </div>
        <div className="flex h-28 items-end justify-between gap-2">
          {d.week.days.map((x) => {
            const isToday = x.date === d.today;
            const v = isToday ? live.today : x.workedMs;
            return (
              <div key={x.date} className="flex flex-1 flex-col items-center gap-1.5" title={`${shortDate(x.date)} : ${formatDuration(v)}`}>
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className={cx("w-full max-w-7 rounded-t-[4px] transition-all", isToday ? "bg-accent" : v > 0 ? "bg-[var(--series-1)]/70" : "bg-surface-2")}
                    style={{ height: v > 0 ? `${Math.max(6, (v / maxDay) * 100)}%` : "4px" }}
                  />
                </div>
                <span className={cx("text-[11px] font-medium", isToday ? "text-accent" : "text-ink-3")}>{DateTime.fromISO(x.date).setLocale("fr").toFormat("ccccc")}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <SectionTitle action={<Link to="/historique" className="text-sm font-medium normal-case tracking-normal text-accent">Tout voir</Link>}>Derniers pointages</SectionTitle>
      <Card className="p-0">
        {d.recent.length === 0 ? (
          <EmptyState icon={<Clock3 />} title="Aucun pointage pour l'instant" text="Appuyez sur « Commencer ma journée » pour enregistrer votre première journée." />
        ) : (
          <ul className="divide-y divide-line">
            {d.recent.map((r) => (
              <li key={r.date}>
                <Link to={`/calendrier?jour=${r.date}`} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-surface-2">
                  <DayDot status={r.status} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{capitalize(shortDate(r.date))}</p>
                    <p className="tabular text-sm text-ink-3">
                      {r.firstStart ? hhmm(r.firstStart, zone) : "—"} → {r.open ? "en cours" : r.lastEnd ? hhmm(r.lastEnd, zone) : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold">{formatDuration(r.date === d.today ? live.today : r.workedMs)}</p>
                    <p className="tabular text-xs text-ink-3">{formatMoney(r.amountCents, user.currency)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Sheet open={payOpen} onClose={() => setPayOpen(false)} title={`Salaire estimé · ${DateTime.now().setLocale("fr").toFormat("LLLL")}`}>
        <PayBreakdown lines={d.month.lines} totalCents={d.month.amountCents} currency={user.currency} />
        <Link to="/profil/remuneration" className="mt-5 block text-center text-sm font-medium text-accent">
          Modifier mes règles de rémunération
        </Link>
      </Sheet>
    </div>
  );
}

function Mini({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className={cx("tabular mt-0.5 text-[15px] font-semibold", highlight && "text-[var(--series-2)]")}>{value}</p>
    </div>
  );
}

export function DayDot({ status, className }: { status: string; className?: string }) {
  const cls: Record<string, string> = {
    complete: "bg-ok",
    ongoing: "bg-accent pulse-dot text-accent",
    incomplete: "bg-warn",
    anomaly: "bg-bad",
    absence: "bg-info",
    empty: "bg-line",
  };
  return <span className={cx("size-2.5 shrink-0 rounded-full", cls[status] ?? "bg-line", className)} />;
}

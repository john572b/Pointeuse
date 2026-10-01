import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDuration, formatMoney } from "@shared/format";
import { ABSENCE_LABELS } from "@shared/pay/engine";
import { api } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import type { DaysResponse, StatsResponse } from "@/lib/types";
import { capitalize, hhmm, longDate } from "@/lib/dates";
import { Button, Spinner } from "@/components/ui";
import { PayBreakdown } from "@/components/PayBreakdown";

/** Rapport imprimable (« Enregistrer en PDF » depuis la boîte d'impression). */
export function ReportPage() {
  const user = useUser();
  const [p] = useSearchParams();
  const from = p.get("from")!;
  const to = p.get("to")!;
  const days = useQuery({ queryKey: ["days", from, to], queryFn: () => api.get<DaysResponse>(`/days?from=${from}&to=${to}`) });
  const stats = useQuery({ queryKey: ["stats", from, to], queryFn: () => api.get<StatsResponse>(`/stats?from=${from}&to=${to}`) });
  const ready = days.data && stats.data;

  useEffect(() => {
    if (ready) setTimeout(() => window.print(), 400);
  }, [ready]);

  if (!ready) return <Spinner className="min-h-dvh" />;
  const s = stats.data.summary;
  const zone = user.timezone;
  const rows = days.data.days.filter((d) => d.shifts.length > 0 || d.absence);

  return (
    <div className="mx-auto max-w-3xl bg-surface px-8 py-10 text-[13px] print:max-w-none print:p-0">
      <div className="no-print mb-6 flex justify-end">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimer / PDF
        </Button>
      </div>
      <header className="mb-6 flex items-start justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-2xl font-bold">Relevé d'heures</h1>
          <p className="text-ink-2">
            {user.firstName} · {user.email}
          </p>
        </div>
        <p className="text-right text-ink-2">
          Du {longDate(from)}
          <br />
          au {longDate(to)}
        </p>
      </header>
      <section className="mb-6 grid grid-cols-4 gap-3">
        {[
          ["Heures travaillées", formatDuration(s.workedMs)],
          ["Heures sup.", formatDuration(s.overtimeMs)],
          ["Jours travaillés", String(s.daysWorked)],
          ["Salaire estimé", formatMoney(s.amountCents, user.currency)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line p-3">
            <p className="text-ink-3">{k}</p>
            <p className="tabular text-lg font-bold">{v}</p>
          </div>
        ))}
      </section>
      <table className="tabular w-full border-collapse">
        <thead>
          <tr className="border-b border-line text-left text-ink-3">
            <th className="py-2 font-medium">Date</th>
            <th className="font-medium">Horaires</th>
            <th className="font-medium">Pause</th>
            <th className="text-right font-medium">Travaillé</th>
            <th className="text-right font-medium">Sup.</th>
            <th className="text-right font-medium">Estimé</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.date} className="break-inside-avoid border-b border-line/60">
              <td className="py-1.5">{capitalize(longDate(d.date))}</td>
              <td>
                {d.shifts.length > 0
                  ? d.shifts.map((x) => `${hhmm(x.startAt, zone)}–${x.endAt ? hhmm(x.endAt, zone) : "…"}`).join(", ")
                  : d.absence && ABSENCE_LABELS[d.absence.kind as keyof typeof ABSENCE_LABELS]}
              </td>
              <td>{formatDuration(d.breakMs)}</td>
              <td className="text-right">{formatDuration(d.workedMs)}</td>
              <td className="text-right">{d.overtimeMs ? formatDuration(d.overtimeMs) : ""}</td>
              <td className="text-right">{formatMoney(d.amountCents, user.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="mt-8 break-inside-avoid">
        <h2 className="mb-2 text-base font-semibold">Détail du calcul</h2>
        <PayBreakdown lines={s.lines} totalCents={s.amountCents} currency={user.currency} />
      </section>
      <p className="mt-8 text-xs text-ink-3">Document généré par Pointeuse (pointeuse.boi.lu) — estimation indicative, ne constitue pas une fiche de paie.</p>
    </div>
  );
}

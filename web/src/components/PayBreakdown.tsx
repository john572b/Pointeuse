import { Info } from "lucide-react";
import { formatMinutes, formatMoney, formatNumber } from "@shared/format";
import type { PayLine } from "@/lib/types";

const money = (v: number, currency: string) => formatMoney(Math.round(v * 100), currency);

/** Détail transparent du calcul : « 4 h 00 Samedi × 15,00 € × 1,25 = 75,00 € ». */
export function PayBreakdown({ lines, totalCents, currency }: { lines: PayLine[]; totalCents: number; currency: string }) {
  if (lines.length === 0) return <p className="py-6 text-center text-sm text-ink-3">Aucune heure sur cette période.</p>;
  return (
    <div>
      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.key} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {l.label}
                {l.percent !== 0 && l.kind === "work" && <span className="ml-1.5 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">{l.percent > 0 ? "+" : ""}{formatNumber(l.percent)} %</span>}
              </p>
              <p className="tabular mt-0.5 text-sm text-ink-3">{formula(l, currency)}</p>
              {l.note && <p className="mt-0.5 text-xs text-ink-3">{l.note}</p>}
            </div>
            <p className="tabular shrink-0 font-semibold">{formatMoney(l.amountCents, currency)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t-2 border-ink/80 pt-3">
        <p className="font-semibold">Total estimé</p>
        <p className="tabular text-lg font-bold">{formatMoney(totalCents, currency)}</p>
      </div>
      <p className="mt-4 flex items-start gap-2 text-xs text-ink-3">
        <Info className="mt-px size-3.5 shrink-0" /> Estimation indicative calculée à partir de vos règles. Ce n'est pas une fiche de paie officielle.
      </p>
    </div>
  );
}

function formula(l: PayLine, currency: string): string {
  if (l.kind === "base") return l.quantity !== undefined && l.quantity < 0.999 ? `${money(l.rate, currency)} × ${formatNumber(l.quantity, 2)} mois` : `Forfait mensuel`;
  if (l.kind === "bonus") {
    if (l.unitLabel === "h") return `${formatMinutes(l.minutes)} × ${money(l.rate, currency)}`;
    if (l.unitLabel === "mois") return `${money(l.rate, currency)} × ${formatNumber(l.quantity ?? 1, 2)} mois`;
    return `${l.quantity ?? 1} jour${(l.quantity ?? 1) > 1 ? "s" : ""} × ${money(l.rate, currency)}`;
  }
  const f = l.factor === 1 ? "" : ` × ${formatNumber(l.factor, 2)}`;
  return `${formatMinutes(l.minutes)} × ${money(l.rate, currency)}${f}`;
}

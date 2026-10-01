/** Formatage partagé (français). */

export function formatDuration(ms: number, opts: { seconds?: boolean } = {}): string {
  const neg = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const core = opts.seconds ? `${h} h ${String(m).padStart(2, "0")} ${String(s).padStart(2, "0")}` : `${h} h ${String(m).padStart(2, "0")}`;
  return neg ? `−${core}` : core;
}

export function formatHours(ms: number): string {
  return formatDuration(ms);
}

export function formatMinutes(min: number): string {
  return formatDuration(min * 60_000);
}

const moneyCache = new Map<string, Intl.NumberFormat>();
export function formatMoney(cents: number, currency = "EUR"): string {
  let f = moneyCache.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat("fr-FR", { style: "currency", currency });
    } catch {
      f = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
    }
    moneyCache.set(currency, f);
  }
  return f.format(cents / 100);
}

export function formatNumber(n: number, digits = 2): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

export function formatTime(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(ms);
}

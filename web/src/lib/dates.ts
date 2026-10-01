import { DateTime } from "luxon";

export const fr = (d: DateTime) => d.setLocale("fr");
export const todayIso = (zone: string) => DateTime.now().setZone(zone).toISODate()!;

export function longDate(iso: string) {
  const s = DateTime.fromISO(iso).setLocale("fr").toFormat("cccc d LLLL");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function shortDate(iso: string) {
  return DateTime.fromISO(iso).setLocale("fr").toFormat("ccc d LLL");
}
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Convertit un instant en valeur pour <input type="datetime-local"> dans le fuseau de l'utilisateur. */
export const toLocalInput = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).toFormat("yyyy-LL-dd'T'HH:mm");
export const fromLocalInput = (v: string, zone: string) => DateTime.fromISO(v, { zone }).toMillis();
/** "HH:mm" sur une date donnée → ms ; si l'heure est avant `after`, on passe au lendemain. */
export function timeOnDate(date: string, hhmm: string, zone: string, after?: number) {
  let t = DateTime.fromISO(`${date}T${hhmm}`, { zone });
  if (after !== undefined && t.toMillis() <= after) t = t.plus({ days: 1 });
  return t.toMillis();
}
export const hhmm = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).toFormat("HH:mm");

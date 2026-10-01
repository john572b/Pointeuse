/**
 * Jours fériés par pays. Pour ajouter un pays : ajouter une entrée dans `COUNTRIES`
 * avec une fonction qui renvoie la liste des jours d'une année donnée.
 */

export interface HolidayDef {
  date: string; // YYYY-MM-DD
  name: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function easterOffset(year: number, days: number): string {
  const e = easterSunday(year);
  e.setUTCDate(e.getUTCDate() + days);
  return iso(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate());
}

type Generator = (y: number) => HolidayDef[];

export const COUNTRIES: Record<string, { name: string; flag: string; generate: Generator }> = {
  LU: {
    name: "Luxembourg",
    flag: "🇱🇺",
    generate: (y) => [
      { date: iso(y, 1, 1), name: "Jour de l'an" },
      { date: easterOffset(y, 1), name: "Lundi de Pâques" },
      { date: iso(y, 5, 1), name: "Fête du Travail" },
      { date: iso(y, 5, 9), name: "Journée de l'Europe" },
      { date: easterOffset(y, 39), name: "Ascension" },
      { date: easterOffset(y, 50), name: "Lundi de Pentecôte" },
      { date: iso(y, 6, 23), name: "Fête nationale" },
      { date: iso(y, 8, 15), name: "Assomption" },
      { date: iso(y, 11, 1), name: "Toussaint" },
      { date: iso(y, 12, 25), name: "Noël" },
      { date: iso(y, 12, 26), name: "Saint-Étienne" },
    ],
  },
  FR: {
    name: "France",
    flag: "🇫🇷",
    generate: (y) => [
      { date: iso(y, 1, 1), name: "Jour de l'an" },
      { date: easterOffset(y, 1), name: "Lundi de Pâques" },
      { date: iso(y, 5, 1), name: "Fête du Travail" },
      { date: iso(y, 5, 8), name: "Victoire 1945" },
      { date: easterOffset(y, 39), name: "Ascension" },
      { date: easterOffset(y, 50), name: "Lundi de Pentecôte" },
      { date: iso(y, 7, 14), name: "Fête nationale" },
      { date: iso(y, 8, 15), name: "Assomption" },
      { date: iso(y, 11, 1), name: "Toussaint" },
      { date: iso(y, 11, 11), name: "Armistice 1918" },
      { date: iso(y, 12, 25), name: "Noël" },
    ],
  },
  BE: {
    name: "Belgique",
    flag: "🇧🇪",
    generate: (y) => [
      { date: iso(y, 1, 1), name: "Jour de l'an" },
      { date: easterOffset(y, 1), name: "Lundi de Pâques" },
      { date: iso(y, 5, 1), name: "Fête du Travail" },
      { date: easterOffset(y, 39), name: "Ascension" },
      { date: easterOffset(y, 50), name: "Lundi de Pentecôte" },
      { date: iso(y, 7, 21), name: "Fête nationale" },
      { date: iso(y, 8, 15), name: "Assomption" },
      { date: iso(y, 11, 1), name: "Toussaint" },
      { date: iso(y, 11, 11), name: "Armistice" },
      { date: iso(y, 12, 25), name: "Noël" },
    ],
  },
  CH: {
    name: "Suisse (jours communs)",
    flag: "🇨🇭",
    generate: (y) => [
      { date: iso(y, 1, 1), name: "Nouvel an" },
      { date: easterOffset(y, -2), name: "Vendredi saint" },
      { date: easterOffset(y, 1), name: "Lundi de Pâques" },
      { date: easterOffset(y, 39), name: "Ascension" },
      { date: easterOffset(y, 50), name: "Lundi de Pentecôte" },
      { date: iso(y, 8, 1), name: "Fête nationale" },
      { date: iso(y, 12, 25), name: "Noël" },
      { date: iso(y, 12, 26), name: "Saint-Étienne" },
    ],
  },
  DE: {
    name: "Allemagne (jours nationaux)",
    flag: "🇩🇪",
    generate: (y) => [
      { date: iso(y, 1, 1), name: "Neujahr" },
      { date: easterOffset(y, -2), name: "Karfreitag" },
      { date: easterOffset(y, 1), name: "Ostermontag" },
      { date: iso(y, 5, 1), name: "Tag der Arbeit" },
      { date: easterOffset(y, 39), name: "Christi Himmelfahrt" },
      { date: easterOffset(y, 50), name: "Pfingstmontag" },
      { date: iso(y, 10, 3), name: "Tag der Deutschen Einheit" },
      { date: iso(y, 12, 25), name: "1. Weihnachtstag" },
      { date: iso(y, 12, 26), name: "2. Weihnachtstag" },
    ],
  },
};

export function holidaysFor(country: string, year: number): HolidayDef[] {
  const c = COUNTRIES[country];
  return c ? c.generate(year).sort((a, b) => a.date.localeCompare(b.date)) : [];
}

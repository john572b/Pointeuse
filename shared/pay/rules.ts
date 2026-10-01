import { z } from "zod";

/** Heure "HH:MM" (00:00 → 23:59). */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:MM attendu");
const percent = z.number().min(-100).max(1000);

export const bonusSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  amount: z.number().min(0).max(100000),
  /** per_day : par journée travaillée · per_hour : par heure travaillée · per_month : forfait mensuel */
  unit: z.enum(["per_day", "per_hour", "per_month"]),
  /** auto : appliquée automatiquement · manual : uniquement les journées cochées */
  mode: z.enum(["auto", "manual"]).default("auto"),
  /** Durée minimale travaillée dans la journée pour déclencher la prime (per_day/auto). */
  minHours: z.number().min(0).max(24).default(0),
});
export type Bonus = z.infer<typeof bonusSchema>;

export const payRulesSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  salaryType: z.enum(["hourly", "monthly"]).default("hourly"),
  hourlyRate: z.number().min(0).max(10000).default(15),
  monthlySalary: z.number().min(0).max(1000000).default(0),
  weeklyHours: z.number().min(0).max(168).default(40),
  dailyHours: z.number().min(0).max(24).default(8),
  /** Jours habituellement travaillés, ISO (1 = lundi … 7 = dimanche). */
  workdays: z.array(z.number().int().min(1).max(7)).max(7).default([1, 2, 3, 4, 5]),
  overtime: z
    .object({
      mode: z.enum(["none", "daily", "weekly", "both"]).default("weekly"),
      percent: percent.default(25),
    })
    .default({ mode: "weekly", percent: 25 }),
  /** Majoration par jour de la semaine (clé ISO "1".."7"). */
  weekdayPercents: z
    .record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), percent)
    .default({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 25, "7": 50 }),
  night: z
    .object({
      enabled: z.boolean().default(true),
      start: hhmm.default("22:00"),
      end: hhmm.default("06:00"),
      percent: percent.default(25),
    })
    .default({ enabled: true, start: "22:00", end: "06:00", percent: 25 }),
  holidayPercent: percent.default(100),
  /** add : les majorations se cumulent · max : seule la plus forte s'applique. */
  stacking: z.enum(["add", "max"]).default("add"),
  bonuses: z.array(bonusSchema).max(30).default([]),
  /** Seuils d'anomalies. */
  breakAlertMinutes: z.number().int().min(5).max(24 * 60).default(90),
  longShiftHours: z.number().min(1).max(24).default(11),
});
export type PayRules = z.infer<typeof payRulesSchema>;

export const DEFAULT_RULES: PayRules = payRulesSchema.parse({});

/** Taux horaire effectif (dérivé du mensuel si besoin). */
export function effectiveHourlyRate(r: PayRules): number {
  if (r.salaryType === "monthly") {
    const monthlyHours = (r.weeklyHours * 52) / 12;
    return monthlyHours > 0 ? r.monthlySalary / monthlyHours : 0;
  }
  return r.hourlyRate;
}

export function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

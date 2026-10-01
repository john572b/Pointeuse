import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { computeDays, isNightMinute, missingDays, summarize, workIntervals, type EngineContext, type ShiftInput } from "./engine";
import { payRulesSchema, type PayRules } from "./rules";
import { easterSunday, holidaysFor } from "../holidays";

const zone = "Europe/Luxembourg";
const at = (iso: string) => DateTime.fromISO(iso, { zone }).toMillis();
const H = 3_600_000;

function ctx(rules: Partial<PayRules> = {}, holidays: Record<string, string> = {}): EngineContext {
  const r = payRulesSchema.parse(rules);
  return { zone, now: at("2026-12-31T23:00"), holidays: new Map(Object.entries(holidays)), rulesFor: () => r };
}
function shift(id: string, start: string, end: string | null, breaks: Array<[string, string | null]> = []): ShiftInput {
  return { id, startAt: at(start), endAt: end ? at(end) : null, breaks: breaks.map(([a, b]) => ({ startAt: at(a), endAt: b ? at(b) : null })) };
}

describe("night range", () => {
  it("handles ranges crossing midnight", () => {
    const s = 22 * 60;
    const e = 2 * 60;
    expect(isNightMinute(23 * 60, s, e)).toBe(true);
    expect(isNightMinute(60, s, e)).toBe(true);
    expect(isNightMinute(3 * 60, s, e)).toBe(false);
    expect(isNightMinute(12 * 60, s, e)).toBe(false);
  });
  it("handles same-day ranges", () => {
    expect(isNightMinute(60, 0, 300)).toBe(true);
    expect(isNightMinute(400, 0, 300)).toBe(false);
  });
});

describe("work intervals", () => {
  it("subtracts breaks", () => {
    const s = shift("a", "2026-03-02T08:00", "2026-03-02T17:00", [["2026-03-02T12:00", "2026-03-02T13:00"]]);
    const total = workIntervals(s, 0).reduce((t, [a, b]) => t + b - a, 0);
    expect(total).toBe(8 * H);
  });
});

describe("pay engine", () => {
  it("reproduces the example from the specification", () => {
    // Lundi 8 h, samedi 4 h, dimanche 2 h, taux 15 €, pas d'heures sup.
    const c = ctx({ hourlyRate: 15, overtime: { mode: "none", percent: 25 }, night: { enabled: false, start: "22:00", end: "06:00", percent: 0 } });
    const days = computeDays(
      [shift("1", "2026-03-02T08:00", "2026-03-02T16:00"), shift("2", "2026-03-07T08:00", "2026-03-07T12:00"), shift("3", "2026-03-08T08:00", "2026-03-08T10:00")],
      [],
      c,
    );
    const s = summarize(days, "2026-03-02", "2026-03-08", c);
    const byLabel = Object.fromEntries(s.lines.map((l) => [l.label, l.amountCents]));
    expect(byLabel["Heures normales"]).toBe(12000);
    expect(byLabel["Samedi"]).toBe(7500);
    expect(byLabel["Dimanche"]).toBe(4500);
    expect(s.amountCents).toBe(24000);
  });

  it("splits a night shift across midnight and attributes it to the start date", () => {
    const c = ctx({ hourlyRate: 10, overtime: { mode: "none", percent: 0 }, weekdayPercents: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }, night: { enabled: true, start: "22:00", end: "02:00", percent: 20 } });
    const days = computeDays([shift("n", "2026-03-04T20:00", "2026-03-05T04:00")], [], c);
    const d = days.get("2026-03-04")!;
    expect(d.workedMs).toBe(8 * H);
    expect(d.nightMs).toBe(4 * H);
    expect(d.amountCents).toBe(4 * 1000 + 4 * 1200);
  });

  it("applies weekly overtime chronologically", () => {
    const c = ctx({ hourlyRate: 20, weeklyHours: 35, overtime: { mode: "weekly", percent: 25 }, night: { enabled: false, start: "22:00", end: "06:00", percent: 0 } });
    const shifts = [2, 3, 4, 5, 6].map((d) => shift(`d${d}`, `2026-03-0${d}T08:00`, `2026-03-0${d}T16:00`)); // lun → ven, 8 h
    const days = computeDays(shifts, [], c);
    const s = summarize(days, "2026-03-02", "2026-03-08", c);
    expect(s.workedMs).toBe(40 * H);
    expect(s.overtimeMs).toBe(5 * H);
    expect(days.get("2026-03-06")!.overtimeMs).toBe(5 * H);
    expect(s.amountCents).toBe(35 * 2000 + 5 * 2500);
  });

  it("counts an emergency intervention entirely as overtime without consuming normal hours", () => {
    const c = ctx({ hourlyRate: 10, weeklyHours: 40, dailyHours: 8, overtime: { mode: "weekly", percent: 50 }, night: { enabled: true, start: "22:00", end: "06:00", percent: 20 } });
    const days = computeDays(
      [shift("day", "2026-03-03T08:00", "2026-03-03T16:00"), { ...shift("urg", "2026-03-03T20:00", "2026-03-03T23:00"), kind: "intervention" as const }],
      [],
      c,
    );
    const d = days.get("2026-03-03")!;
    expect(d.workedMs).toBe(11 * H);
    expect(d.normalMs).toBe(8 * H);
    expect(d.overtimeMs).toBe(3 * H);
    // 8 h × 10 + 2 h × 10 × 1,5 (intervention) + 1 h × 10 × 1,7 (intervention + nuit)
    expect(d.amountCents).toBe(8000 + 3000 + 1700);
    expect(d.lines.map((l) => l.label)).toContain("Intervention");
    expect(d.anomalies).toEqual([]);
    // Le lendemain, les heures normales de la semaine ne sont pas entamées par l'intervention.
    const next = computeDays([{ ...shift("urg", "2026-03-03T20:00", "2026-03-03T23:00"), kind: "intervention" as const }, shift("d2", "2026-03-04T08:00", "2026-03-04T16:00")], [], c);
    expect(next.get("2026-03-04")!.overtimeMs).toBe(0);
    expect(next.get("2026-03-03")!.status).toBe("complete");
  });

  it("applies daily overtime", () => {
    const c = ctx({ hourlyRate: 10, dailyHours: 8, overtime: { mode: "daily", percent: 50 } });
    const days = computeDays([shift("a", "2026-03-03T07:00", "2026-03-03T17:00")], [], c);
    expect(days.get("2026-03-03")!.overtimeMs).toBe(2 * H);
    expect(days.get("2026-03-03")!.amountCents).toBe(8 * 1000 + 2 * 1500);
  });

  it("stacks majorations or keeps the highest", () => {
    const base = { hourlyRate: 10, overtime: { mode: "none" as const, percent: 0 }, night: { enabled: true, start: "22:00", end: "06:00", percent: 20 } };
    const sunNight = [shift("s", "2026-03-08T22:00", "2026-03-08T23:00")]; // dimanche 50 % + nuit 20 %
    expect(computeDays(sunNight, [], ctx({ ...base, stacking: "add" })).get("2026-03-08")!.amountCents).toBe(1700);
    expect(computeDays(sunNight, [], ctx({ ...base, stacking: "max" })).get("2026-03-08")!.amountCents).toBe(1500);
  });

  it("applies holiday percent instead of weekday percent", () => {
    const c = ctx({ hourlyRate: 10, holidayPercent: 100, overtime: { mode: "none", percent: 0 } }, { "2026-05-01": "Fête du Travail" });
    const d = computeDays([shift("h", "2026-05-01T08:00", "2026-05-01T10:00")], [], c).get("2026-05-01")!;
    expect(d.amountCents).toBe(4000);
    expect(d.holidayMs).toBe(2 * H);
    expect(d.lines[0].label).toBe("Fête du Travail");
  });

  it("handles custom bonuses", () => {
    const c = ctx({
      hourlyRate: 10,
      overtime: { mode: "none", percent: 0 },
      bonuses: [
        { id: "repas", name: "Prime de repas", amount: 9, unit: "per_day", mode: "auto", minHours: 6 },
        { id: "chantier", name: "Prime de chantier", amount: 20, unit: "per_day", mode: "manual", minHours: 0 },
        { id: "transport", name: "Transport", amount: 62, unit: "per_month", mode: "auto", minHours: 0 },
      ],
    });
    const s1 = shift("a", "2026-03-02T08:00", "2026-03-02T16:00");
    const s2 = { ...shift("b", "2026-03-03T08:00", "2026-03-03T12:00"), bonusIds: ["chantier"] };
    const days = computeDays([s1, s2], [], c);
    expect(days.get("2026-03-02")!.amountCents).toBe(8000 + 900);
    expect(days.get("2026-03-03")!.amountCents).toBe(4000 + 2000);
    const s = summarize(days, "2026-03-01", "2026-03-31", c);
    expect(s.amountCents).toBe(8900 + 6000 + 6200);
  });

  it("handles a monthly salary", () => {
    const c = ctx({ salaryType: "monthly", monthlySalary: 2600, weeklyHours: 40, overtime: { mode: "daily", percent: 25 }, dailyHours: 8 });
    const rate = 2600 / ((40 * 52) / 12); // 15 €/h
    expect(rate).toBe(15);
    const days = computeDays([shift("a", "2026-03-07T08:00", "2026-03-07T18:00")], [], c); // samedi, 10 h
    const s = summarize(days, "2026-03-01", "2026-03-31", c);
    // 2600 fixe + 8 h × 15 × 0,25 (supplément samedi) + 2 h × 15 × 1,50 (samedi + h. sup.)
    expect(s.amountCents).toBe(260000 + 3000 + 4500);
  });

  it("subtracts breaks and detects anomalies", () => {
    const c = { ...ctx({ breakAlertMinutes: 60, longShiftHours: 10 }), now: at("2026-03-10T09:00") };
    const days = computeDays(
      [shift("a", "2026-03-02T08:00", "2026-03-02T17:00", [["2026-03-02T11:00", "2026-03-02T13:00"]]), shift("b", "2026-03-09T08:00", null)],
      [],
      c,
    );
    expect(days.get("2026-03-02")!.workedMs).toBe(7 * H);
    expect(days.get("2026-03-02")!.anomalies.map((a) => a.code)).toContain("long_break");
    expect(days.get("2026-03-09")!.anomalies.map((a) => a.code)).toContain("open_shift");
    expect(days.get("2026-03-09")!.status).toBe("anomaly");
    const missing = missingDays(days, "2026-03-02", "2026-03-10", c).map((m) => m.date);
    expect(missing).toEqual(["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]);
  });

  it("counts paid leave", () => {
    const c = ctx({ hourlyRate: 12 });
    const days = computeDays([], [{ date: "2026-03-04", kind: "conge", paid: true, hours: 8 }], c);
    const s = summarize(days, "2026-03-01", "2026-03-31", c);
    expect(s.amountCents).toBe(9600);
    expect(s.leaveDays).toBe(1);
    expect(days.get("2026-03-04")!.status).toBe("absence");
  });

  it("is correct across a DST change", () => {
    // Nuit du 28 au 29 mars 2026 : passage à l'heure d'été à 2 h (une heure de moins).
    const c = ctx({ hourlyRate: 10, overtime: { mode: "none", percent: 0 } });
    const d = computeDays([shift("dst", "2026-03-28T22:00", "2026-03-29T06:00")], [], c).get("2026-03-28")!;
    expect(d.workedMs).toBe(7 * H);
  });
});

describe("holidays", () => {
  it("computes Easter", () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(easterSunday(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
  });
  it("lists Luxembourg holidays", () => {
    const lu = holidaysFor("LU", 2026).map((h) => h.date);
    expect(lu).toContain("2026-04-06");
    expect(lu).toContain("2026-05-14");
    expect(lu).toContain("2026-06-23");
    expect(lu).toHaveLength(11);
  });
});

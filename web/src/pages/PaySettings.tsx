import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatMoney, formatNumber } from "@shared/format";
import { computeDays } from "@shared/pay/engine";
import { effectiveHourlyRate, payRulesSchema } from "@shared/pay/rules";
import { api } from "@/lib/api";
import { useInvalidateData, useUser } from "@/lib/hooks";
import type { Bonus, PayRules, User } from "@/lib/types";
import { Button, Card, Field, Input, Notice, PageHeader, Segmented, Select, Spinner, Toggle, cx } from "@/components/ui";

const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const CURRENCIES = ["EUR", "CHF", "USD", "GBP", "CAD"];

export function PaySettings() {
  const q = useQuery({ queryKey: ["pay-settings"], queryFn: () => api.get<{ rules: PayRules; versions: Array<{ id: string; effectiveFrom: string }> }>("/settings/pay") });
  if (!q.data) return <Spinner />;
  return <Editor initial={q.data.rules} versions={q.data.versions} />;
}

function Editor({ initial, versions }: { initial: PayRules; versions: Array<{ effectiveFrom: string }> }) {
  const user = useUser();
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  const [r, setR] = useState<PayRules>(initial);
  const [currency, setCurrency] = useState(user.currency);
  const [goal, setGoal] = useState<string>(user.prefs.weeklyGoalHours === null ? "" : String(user.prefs.weeklyGoalHours));
  const [applyFrom, setApplyFrom] = useState<"all" | "month" | "today">(versions.length > 1 ? "month" : "all");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const set = <K extends keyof PayRules>(k: K, v: PayRules[K]) => setR((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")));

  useEffect(() => setMsg(null), [r, currency, goal]);

  const save = async () => {
    const parsed = payRulesSchema.safeParse(r);
    if (!parsed.success) return setMsg({ tone: "bad", text: parsed.error.issues[0].message });
    setSaving(true);
    try {
      const now = DateTime.now().setZone(user.timezone);
      const effectiveFrom = applyFrom === "all" ? null : applyFrom === "month" ? now.startOf("month").toISODate() : now.toISODate();
      await api.put("/settings/pay", { rules: parsed.data, effectiveFrom });
      const u = await api.patch<{ user: User }>("/account/profile", { currency, prefs: { weeklyGoalHours: goal === "" ? null : num(goal) } });
      qc.setQueryData(["me"], u.user);
      invalidate();
      setMsg({ tone: "ok", text: "Règles enregistrées. Vos estimations sont à jour." });
    } catch (e: any) {
      setMsg({ tone: "bad", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const rate = effectiveHourlyRate(r);

  return (
    <div className="animate-in pb-28">
      <PageHeader title="Rémunération" subtitle="Vos propres règles : le salaire estimé en découle." back="/profil" />

      <div className="space-y-4">
        <Card className="space-y-4">
          <p className="font-semibold">Salaire</p>
          <Segmented value={r.salaryType} onChange={(v) => set("salaryType", v)} options={[{ value: "hourly", label: "Payé à l'heure" }, { value: "monthly", label: "Salaire mensuel" }]} />
          <div className="grid grid-cols-2 gap-3">
            {r.salaryType === "hourly" ? (
              <Field label="Taux horaire brut">{(id) => <NumInput id={id} value={r.hourlyRate} onChange={(v) => set("hourlyRate", v)} suffix={`${currency}/h`} />}</Field>
            ) : (
              <Field label="Salaire mensuel" hint={`Soit ${formatMoney(Math.round(rate * 100), currency)}/h pour les majorations`}>
                {(id) => <NumInput id={id} value={r.monthlySalary} onChange={(v) => set("monthlySalary", v)} suffix={currency} />}
              </Field>
            )}
            <Field label="Devise">
              {(id) => (
                <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <p className="font-semibold">Temps de travail</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Heures / semaine">{(id) => <NumInput id={id} value={r.weeklyHours} onChange={(v) => set("weeklyHours", v)} suffix="h" />}</Field>
            <Field label="Heures / jour">{(id) => <NumInput id={id} value={r.dailyHours} onChange={(v) => set("dailyHours", v)} suffix="h" />}</Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-2">Jours habituellement travaillés</p>
            <div className="flex gap-1.5">
              {DAY_NAMES.map((d, i) => {
                const on = r.workdays.includes(i + 1);
                return (
                  <button
                    key={d}
                    onClick={() => set("workdays", on ? r.workdays.filter((x) => x !== i + 1) : [...r.workdays, i + 1].sort())}
                    className={cx("h-10 flex-1 rounded-xl text-sm font-semibold transition", on ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-3")}
                    aria-pressed={on}
                    title={d}
                  >
                    {d.slice(0, 2)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-ink-3">Sert à repérer les jours oubliés.</p>
          </div>
          <Field label="Objectif hebdomadaire" hint={`Vide = ${r.weeklyHours} h (heures normales)`}>
            {(id) => <Input id={id} type="number" inputMode="decimal" min={0} max={168} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={String(r.weeklyHours)} suffix="h" />}
          </Field>
        </Card>

        <Section title="Heures supplémentaires" summary={r.overtime.mode === "none" ? "Non calculées" : `+${r.overtime.percent} %`}>
          <Field label="Calcul">
            {(id) => (
              <Select id={id} value={r.overtime.mode} onChange={(e) => set("overtime", { ...r.overtime, mode: e.target.value as PayRules["overtime"]["mode"] })}>
                <option value="weekly">Au-delà des heures normales de la semaine</option>
                <option value="daily">Au-delà des heures normales du jour</option>
                <option value="both">Les deux (jour et semaine)</option>
                <option value="none">Pas d'heures supplémentaires</option>
              </Select>
            )}
          </Field>
          {r.overtime.mode !== "none" && <Field label="Majoration">{(id) => <NumInput id={id} value={r.overtime.percent} onChange={(v) => set("overtime", { ...r.overtime, percent: v })} suffix="%" />}</Field>}
        </Section>

        <Section
          title="Majorations par jour"
          summary={
            DAY_NAMES.map((d, i) => [d, r.weekdayPercents[String(i + 1) as "1"]] as const)
              .filter(([, p]) => p)
              .map(([d, p]) => `${d.slice(0, 3)}. +${p} %`)
              .join(" · ") || "Aucune"
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DAY_NAMES.map((d, i) => (
              <Field key={d} label={d}>
                {(id) => <NumInput id={id} value={r.weekdayPercents[String(i + 1) as "1"] ?? 0} onChange={(v) => set("weekdayPercents", { ...r.weekdayPercents, [String(i + 1)]: v })} suffix="%" />}
              </Field>
            ))}
          </div>
        </Section>

        <Section title="Travail de nuit" summary={r.night.enabled ? `${r.night.start} → ${r.night.end} · +${r.night.percent} %` : "Désactivé"}>
          <Toggle label="Majorer les heures de nuit" checked={r.night.enabled} onChange={(v) => set("night", { ...r.night, enabled: v })} />
          {r.night.enabled && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Début">{(id) => <Input id={id} type="time" value={r.night.start} onChange={(e) => set("night", { ...r.night, start: e.target.value })} />}</Field>
                <Field label="Fin">{(id) => <Input id={id} type="time" value={r.night.end} onChange={(e) => set("night", { ...r.night, end: e.target.value })} />}</Field>
                <Field label="Majoration">{(id) => <NumInput id={id} value={r.night.percent} onChange={(v) => set("night", { ...r.night, percent: v })} suffix="%" />}</Field>
              </div>
              <p className="text-xs text-ink-3">Une plage qui traverse minuit (ex. 22:00 → 06:00) est prise en charge.</p>
            </>
          )}
        </Section>

        <Section title="Jours fériés" summary={`+${r.holidayPercent} %`}>
          <Field label="Majoration un jour férié" hint="Remplace la majoration du jour de la semaine.">
            {(id) => <NumInput id={id} value={r.holidayPercent} onChange={(v) => set("holidayPercent", v)} suffix="%" />}
          </Field>
          <Link to="/profil/jours-feries" className="block text-sm font-medium text-accent">
            Gérer la liste des jours fériés →
          </Link>
        </Section>

        <Section title="Cumul des majorations" summary={r.stacking === "add" ? "Elles s'additionnent" : "Seule la plus forte"}>
          <Segmented value={r.stacking} onChange={(v) => set("stacking", v)} options={[{ value: "add", label: "Additionner" }, { value: "max", label: "La plus forte" }]} />
          <p className="text-sm text-ink-3">
            Ex. : un dimanche de nuit (+{r.weekdayPercents["7"]} % et +{r.night.percent} %) sera majoré de{" "}
            <b>+{r.stacking === "add" ? r.weekdayPercents["7"] + (r.night.enabled ? r.night.percent : 0) : Math.max(r.weekdayPercents["7"], r.night.enabled ? r.night.percent : 0)} %</b>.
          </p>
        </Section>

        <Section title="Primes" summary={r.bonuses.length ? r.bonuses.map((b) => b.name).join(", ") : "Aucune"}>
          <BonusesEditor bonuses={r.bonuses} currency={currency} onChange={(b) => set("bonuses", b)} />
        </Section>

        <Section title="Alertes d'anomalies" summary={`Pause > ${r.breakAlertMinutes} min · journée > ${r.longShiftHours} h`}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pause anormale au-delà de">{(id) => <NumInput id={id} value={r.breakAlertMinutes} onChange={(v) => set("breakAlertMinutes", Math.round(v))} suffix="min" />}</Field>
            <Field label="Oubli de sortie au-delà de">{(id) => <NumInput id={id} value={r.longShiftHours} onChange={(v) => set("longShiftHours", v)} suffix="h" />}</Field>
          </div>
        </Section>

        <Preview rules={r} currency={currency} zone={user.timezone} />
      </div>

      {/* Barre d'enregistrement */}
      <div className="safe-bottom fixed inset-x-0 bottom-[64px] z-30 border-t border-line bg-surface/90 backdrop-blur-xl lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
          {msg ? (
            <div className="flex-1">
              <Notice tone={msg.tone}>{msg.text}</Notice>
            </div>
          ) : (
            <Select value={applyFrom} onChange={(e) => setApplyFrom(e.target.value as typeof applyFrom)} className="h-11 flex-1 text-sm" aria-label="Appliquer les règles">
              <option value="all">Appliquer à tout mon historique</option>
              <option value="month">Appliquer à partir du 1er de ce mois</option>
              <option value="today">Appliquer à partir d'aujourd'hui</option>
            </Select>
          )}
          <Button onClick={save} loading={saving} className="h-11 sm:w-40">
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}

function NumInput({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void; id?: string; suffix?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text.replace(",", ".")) !== value) setText(String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,-]/g, "");
        setText(t);
        const n = Number(t.replace(",", "."));
        if (t !== "" && !Number.isNaN(n)) onChange(n);
        if (t === "") onChange(0);
      }}
    />
  );
}

function Section({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-5 py-4 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-sm text-ink-3">{summary}</span>
        </span>
        <ChevronDown className={cx("size-5 text-ink-3 transition", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-4 px-5 pb-5">{children}</div>}
    </Card>
  );
}

function BonusesEditor({ bonuses, onChange, currency }: { bonuses: Bonus[]; onChange: (b: Bonus[]) => void; currency: string }) {
  const update = (i: number, patch: Partial<Bonus>) => onChange(bonuses.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const add = () => onChange([...bonuses, { id: Math.random().toString(36).slice(2, 10), name: "Prime de repas", amount: 10, unit: "per_day", mode: "auto", minHours: 6 }]);
  return (
    <div className="space-y-3">
      {bonuses.length === 0 && <p className="text-sm text-ink-3">Repas, transport, chantier, nuit… Ajoutez les primes que vous percevez.</p>}
      {bonuses.map((b, i) => (
        <div key={b.id} className="space-y-3 rounded-2xl border border-line p-4">
          <div className="flex gap-2">
            <Input value={b.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Nom de la prime" />
            <button onClick={() => onChange(bonuses.filter((_, j) => j !== i))} className="grid size-12 shrink-0 place-items-center rounded-2xl bg-bad-soft text-bad" aria-label="Supprimer la prime">
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumInput value={b.amount} onChange={(v) => update(i, { amount: v })} suffix={currency} />
            <Select value={b.unit} onChange={(e) => update(i, { unit: e.target.value as Bonus["unit"] })} aria-label="Unité">
              <option value="per_day">par jour travaillé</option>
              <option value="per_hour">par heure</option>
              <option value="per_month">par mois</option>
            </Select>
          </div>
          {b.unit !== "per_month" && (
            <div className="grid grid-cols-2 gap-3">
              <Select value={b.mode} onChange={(e) => update(i, { mode: e.target.value as Bonus["mode"] })} aria-label="Application">
                <option value="auto">Automatique</option>
                <option value="manual">Jours cochés uniquement</option>
              </Select>
              {b.mode === "auto" && b.unit === "per_day" && <NumInput value={b.minHours} onChange={(v) => update(i, { minHours: v })} suffix="h min." />}
            </div>
          )}
          {b.mode === "manual" && b.unit !== "per_month" && <p className="text-xs text-ink-3">Cochez cette prime dans la fiche d'une journée (calendrier) pour l'appliquer.</p>}
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={add}>
        <Plus className="size-4" /> Ajouter une prime
      </Button>
    </div>
  );
}

/** Aperçu instantané du calcul avec le moteur partagé. */
function Preview({ rules, currency, zone }: { rules: PayRules; currency: string; zone: string }) {
  const examples = useMemo(() => {
    const parsed = payRulesSchema.safeParse(rules);
    if (!parsed.success) return [];
    const r = { ...parsed.data, overtime: { ...parsed.data.overtime, mode: "none" as const }, bonuses: [] };
    // Semaine de référence : 5 au 11 janvier 2026 (lundi → dimanche), sans jour férié.
    const sample = (label: string, start: string, end: string) => {
      const s = DateTime.fromISO(start, { zone }).toMillis();
      const e = DateTime.fromISO(end, { zone }).toMillis();
      const day = computeDays([{ id: "x", startAt: s, endAt: e, breaks: [] }], [], { zone, now: e, holidays: new Map(), rulesFor: () => r }).values().next().value!;
      return { label, cents: day.amountCents, hours: (e - s) / 3_600_000 };
    };
    return [
      sample("Mardi, 8 h en journée", "2026-01-06T08:00", "2026-01-06T16:00"),
      sample("Samedi, 8 h en journée", "2026-01-10T08:00", "2026-01-10T16:00"),
      sample("Dimanche, 8 h en journée", "2026-01-11T08:00", "2026-01-11T16:00"),
      ...(r.night.enabled ? [sample("Mercredi, nuit 22 h → 6 h", "2026-01-07T22:00", "2026-01-08T06:00")] : []),
    ];
  }, [rules, zone]);
  if (examples.length === 0) return null;
  return (
    <Card>
      <p className="font-semibold">Aperçu</p>
      <p className="mb-3 text-sm text-ink-3">
        {rules.salaryType === "monthly" ? "Suppléments ajoutés au salaire mensuel" : "Ce que rapporterait une journée"}, hors heures sup. et primes.
      </p>
      <ul className="divide-y divide-line">
        {examples.map((e) => (
          <li key={e.label} className="flex justify-between py-2.5 text-[15px]">
            <span className="text-ink-2">{e.label}</span>
            <span className="tabular font-semibold">{formatMoney(e.cents, currency)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-3">Taux de référence : {formatNumber(effectiveHourlyRate(rules), 2)} {currency}/h.</p>
    </Card>
  );
}

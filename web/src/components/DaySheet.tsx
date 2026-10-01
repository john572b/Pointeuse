import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Palmtree, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDuration, formatMoney } from "@shared/format";
import { ABSENCE_LABELS } from "@shared/pay/engine";
import { api } from "@/lib/api";
import { useInvalidateData, useUser } from "@/lib/hooks";
import type { DaysResponse, PayRules, Shift } from "@/lib/types";
import { hhmm, longDate, timeOnDate } from "@/lib/dates";
import { Button, Field, Input, Notice, Select, Sheet, Spinner, Toggle, cx } from "./ui";
import { PayBreakdown } from "./PayBreakdown";
import { DayTimeline } from "./DayTimeline";

type Mode = { kind: "view" } | { kind: "shift"; shift: Shift | null } | { kind: "absence" };

/** Fiche détaillée d'une journée, avec correction et saisie de congé. */
export function DaySheet({ date, onClose }: { date: string | null; onClose: () => void }) {
  const user = useUser();
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [showCalc, setShowCalc] = useState(false);
  useEffect(() => {
    setMode({ kind: "view" });
    setShowCalc(false);
  }, [date]);

  const q = useQuery({ queryKey: ["days", date, date], queryFn: () => api.get<DaysResponse>(`/days?from=${date}&to=${date}`), enabled: !!date });
  const day = q.data?.days[0];
  const missing = q.data?.missing[0];
  const zone = user.timezone;

  const title = date ? longDate(date) : "";
  return (
    <Sheet open={!!date} onClose={onClose} title={mode.kind === "view" ? title : mode.kind === "absence" ? "Absence / congé" : mode.shift ? "Corriger la journée" : "Ajouter des horaires"}>
      {!date || q.isLoading ? (
        <Spinner />
      ) : mode.kind === "shift" ? (
        <ShiftEditor date={date} shift={mode.shift} onDone={() => setMode({ kind: "view" })} />
      ) : mode.kind === "absence" ? (
        <AbsenceEditor date={date} current={day?.absence} onDone={() => setMode({ kind: "view" })} />
      ) : (
        <div className="space-y-5">
          {day?.holidayName && <Notice tone="info">🎉 Jour férié : {day.holidayName}</Notice>}
          {[...(day?.anomalies ?? []), ...(missing ? [missing] : [])].map((a, i) => (
            <Notice key={i} tone={a.code === "incomplete" ? "warn" : "bad"} icon={<AlertTriangle className="size-4" />}>
              {a.message}
            </Notice>
          ))}
          {day?.absence && (
            <div className="flex items-center justify-between rounded-2xl bg-info-soft px-4 py-3 text-info">
              <span className="flex items-center gap-2 font-medium">
                <Palmtree className="size-4" /> {ABSENCE_LABELS[day.absence.kind as keyof typeof ABSENCE_LABELS]}
                {day.absence.paid ? ` · ${day.absence.hours} h payées` : " · non payé"}
              </span>
              <button onClick={() => setMode({ kind: "absence" })} className="text-sm font-semibold">
                Modifier
              </button>
            </div>
          )}

          {day && day.shifts.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Travaillé" value={formatDuration(day.workedMs)} big />
                <Stat label="Salaire estimé" value={formatMoney(day.amountCents, user.currency)} big />
                <Stat label="Pauses" value={formatDuration(day.breakMs)} />
                <Stat label="Heures sup." value={formatDuration(day.overtimeMs)} />
                {day.nightMs > 0 && <Stat label="Heures de nuit" value={formatDuration(day.nightMs)} />}
                {day.holidayMs > 0 && <Stat label="Heures fériées" value={formatDuration(day.holidayMs)} />}
              </div>
              <DayTimeline shifts={day.shifts} zone={zone} now={Date.now()} />
              <ul className="space-y-2">
                {day.shifts.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="tabular font-semibold">
                        {hhmm(s.startAt, zone)} → {s.endAt ? hhmm(s.endAt, zone) : "en cours"}
                      </p>
                      <p className="text-sm text-ink-3">
                        {s.breaks.length === 0 ? "Sans pause" : s.breaks.map((b) => `Pause ${hhmm(b.startAt, zone)}–${b.endAt ? hhmm(b.endAt, zone) : "…"}`).join(" · ")}
                        {s.kind === "intervention" && " · intervention (heures sup.)"}
                        {s.editedAt && " · corrigé"}
                        {s.source === "manual" && " · saisi à la main"}
                      </p>
                      {s.note && <p className="mt-1 text-sm text-ink-2">« {s.note} »</p>}
                    </div>
                    <button onClick={() => setMode({ kind: "shift", shift: s })} className="grid size-9 place-items-center rounded-xl bg-surface text-ink-2" aria-label="Corriger">
                      <Pencil className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {day.lines.some((l) => l.kind === "work" && l.percent !== 0) && (
                <div className="flex flex-wrap gap-2">
                  {day.lines
                    .filter((l) => l.kind === "work" && l.percent !== 0)
                    .map((l) => (
                      <span key={l.key} className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
                        {l.label} {l.percent > 0 ? "+" : ""}
                        {l.percent} %
                      </span>
                    ))}
                </div>
              )}
              <button onClick={() => setShowCalc(!showCalc)} className="flex w-full items-center justify-between rounded-2xl border border-line px-4 py-3 text-sm font-medium">
                Comment est calculé ce montant ?
                <ChevronDown className={cx("size-4 transition", showCalc && "rotate-180")} />
              </button>
              {showCalc && <PayBreakdown lines={day.lines} totalCents={day.amountCents} currency={user.currency} />}
            </>
          ) : (
            !day?.absence && <p className="py-4 text-center text-ink-3">Aucun pointage ce jour-là.</p>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button variant="secondary" onClick={() => setMode({ kind: "shift", shift: null })}>
              <Plus className="size-4" /> Horaires
            </Button>
            <Button variant="secondary" onClick={() => setMode({ kind: "absence" })}>
              <Palmtree className="size-4" /> {day?.absence ? "Absence" : "Congé"}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-3">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className={cx("tabular font-semibold", big ? "text-xl" : "text-base")}>{value}</p>
    </div>
  );
}

function ShiftEditor({ date, shift, onDone }: { date: string; shift: Shift | null; onDone: () => void }) {
  const user = useUser();
  const zone = user.timezone;
  const invalidate = useInvalidateData();
  const rules = useQuery({ queryKey: ["pay-settings"], queryFn: () => api.get<{ rules: PayRules }>("/settings/pay") });
  const manualBonuses = rules.data?.rules.bonuses.filter((b) => b.mode === "manual") ?? [];
  const isOpen = shift !== null && shift.endAt === null;

  const [start, setStart] = useState(shift ? hhmm(shift.startAt, zone) : "08:00");
  const [end, setEnd] = useState(shift?.endAt ? hhmm(shift.endAt, zone) : isOpen ? "" : "17:00");
  const [breaks, setBreaks] = useState(shift ? shift.breaks.map((b) => ({ start: hhmm(b.startAt, zone), end: b.endAt ? hhmm(b.endAt, zone) : "" })) : [{ start: "12:00", end: "13:00" }]);
  const [note, setNote] = useState(shift?.note ?? "");
  const [bonusIds, setBonusIds] = useState<string[]>(shift?.bonusIds ?? []);
  const [intervention, setIntervention] = useState(shift?.kind === "intervention");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const startMs = timeOnDate(date, start || "00:00", zone);
  const endMs = end ? timeOnDate(date, end, zone, startMs) : null;
  const nextDay = !!end && end <= start;

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const body = {
        startAt: startMs,
        endAt: endMs,
        breaks: breaks
          .filter((b) => b.start)
          .map((b) => {
            const s = timeOnDate(date, b.start, zone, startMs - 1);
            return { startAt: s, endAt: b.end ? timeOnDate(date, b.end, zone, s) : null };
          }),
        note,
        bonusIds,
        kind: intervention ? "intervention" : "normal",
      };
      if (shift) await api.put(`/shifts/${shift.id}`, body);
      else await api.post("/shifts", body);
      invalidate();
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!shift || !confirm("Supprimer définitivement ces horaires ?")) return;
    await api.del(`/shifts/${shift.id}`);
    invalidate();
    onDone();
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Début">{(id) => <Input id={id} type="time" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label={nextDay ? "Fin (lendemain)" : "Fin"} hint={isOpen && !end ? "Laisser vide : en cours" : undefined}>
          {(id) => <Input id={id} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />}
        </Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-ink-2">Pauses</p>
        <div className="space-y-2">
          {breaks.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="time" aria-label="Début de pause" value={b.start} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span className="text-ink-3">→</span>
              <Input type="time" aria-label="Fin de pause" value={b.end} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <button onClick={() => setBreaks(breaks.filter((_, j) => j !== i))} className="grid size-10 shrink-0 place-items-center rounded-xl text-ink-3 hover:bg-surface-2" aria-label="Retirer la pause">
                <X className="size-4" />
              </button>
            </div>
          ))}
          <button onClick={() => setBreaks([...breaks, { start: "", end: "" }])} className="flex items-center gap-1.5 text-sm font-medium text-accent">
            <Plus className="size-4" /> Ajouter une pause
          </button>
        </div>
      </div>
      <Toggle label="Intervention d'urgence" description="Appel en dehors des horaires : compté uniquement en heures supplémentaires" checked={intervention} onChange={setIntervention} />
      {manualBonuses.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-ink-2">Primes de cette journée</p>
          {manualBonuses.map((b) => (
            <Toggle key={b.id} label={b.name} checked={bonusIds.includes(b.id)} onChange={(on) => setBonusIds(on ? [...bonusIds, b.id] : bonusIds.filter((x) => x !== b.id))} />
          ))}
        </div>
      )}
      <Field label="Note (facultatif)">{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Ex. : chantier Kirchberg" />}</Field>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          Annuler
        </Button>
        <Button className="flex-1" onClick={save} loading={saving}>
          Enregistrer
        </Button>
      </div>
      {shift && (
        <Button variant="danger" className="w-full" onClick={remove}>
          <Trash2 className="size-4" /> Supprimer
        </Button>
      )}
    </div>
  );
}

function AbsenceEditor({ date, current, onDone }: { date: string; current?: { kind: string; paid: boolean; hours: number; note: string }; onDone: () => void }) {
  const invalidate = useInvalidateData();
  const rules = useQuery({ queryKey: ["pay-settings"], queryFn: () => api.get<{ rules: PayRules }>("/settings/pay") });
  const [kind, setKind] = useState(current?.kind ?? "conge");
  const [paid, setPaid] = useState(current?.paid ?? true);
  const [hours, setHours] = useState<string>(current ? String(current.hours) : "");
  const [error, setError] = useState("");
  const effectiveHours = hours === "" ? (rules.data?.rules.dailyHours ?? 8) : Number(hours);

  const save = async () => {
    try {
      await api.put(`/absences/${date}`, { kind, paid, hours: paid ? effectiveHours : 0, note: "" });
      invalidate();
      onDone();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const remove = async () => {
    await api.del(`/absences/${date}`);
    invalidate();
    onDone();
  };
  return (
    <div className="space-y-4">
      <Field label="Type">
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(ABSENCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Toggle label="Journée payée" description="Comptée dans le salaire estimé" checked={paid} onChange={setPaid} />
      {paid && (
        <Field label="Heures payées">{(id) => <Input id={id} type="number" inputMode="decimal" min={0} max={24} step={0.25} placeholder={String(rules.data?.rules.dailyHours ?? 8)} value={hours} onChange={(e) => setHours(e.target.value)} suffix="h" />}</Field>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          Annuler
        </Button>
        <Button className="flex-1" onClick={save}>
          Enregistrer
        </Button>
      </div>
      {current && (
        <Button variant="danger" className="w-full" onClick={remove}>
          <Trash2 className="size-4" /> Retirer l'absence
        </Button>
      )}
    </div>
  );
}

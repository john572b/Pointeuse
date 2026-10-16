import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { DateTime } from "luxon";
import { formatDuration } from "@shared/format";
import { api } from "@/lib/api";
import { useInvalidateData, useUser } from "@/lib/hooks";
import type { Shift } from "@/lib/types";
import { hhmm, timeOnDate } from "@/lib/dates";
import { Button, Input, Notice, Sheet } from "./ui";

const CHIPS = [
  { label: "−5 min", minutes: 5 },
  { label: "−15 min", minutes: 15 },
  { label: "−30 min", minutes: 30 },
  { label: "−1 h", minutes: 60 },
];

/**
 * Correction rapide de l'heure d'arrivée (oubli de pointage) : une heure à saisir, quelques
 * raccourcis « plus tôt de… », et l'effet sur la journée affiché avant d'enregistrer.
 */
export function StartTimeSheet({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const user = useUser();
  const zone = user.timezone;
  const invalidate = useInvalidateData();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (shift) {
      setValue(hhmm(shift.startAt, zone));
      setError("");
    }
  }, [shift?.id, shift?.startAt, zone]);

  if (!shift) return null;

  const date = DateTime.fromMillis(shift.startAt, { zone }).toISODate()!;
  const limit = shift.endAt ?? Date.now();
  const newStart = value ? timeOnDate(date, value, zone) : shift.startAt;
  const delta = shift.startAt - newStart; // > 0 : on avance l'arrivée, la journée s'allonge
  const invalid = !value || newStart >= limit;

  const shiftBy = (minutes: number) => {
    const t = DateTime.fromMillis(newStart, { zone }).minus({ minutes });
    // On reste sur le même jour : au-delà de minuit, la saisie manuelle prend le relais.
    if (t.toISODate() === date) setValue(t.toFormat("HH:mm"));
  };

  const save = async () => {
    setError("");
    if (invalid) return setError(shift.endAt ? "L'arrivée doit être avant la fin de journée." : "L'heure d'arrivée ne peut pas être dans le futur.");
    setSaving(true);
    try {
      await api.put(`/shifts/${shift.id}`, {
        startAt: newStart,
        endAt: shift.endAt,
        breaks: shift.breaks.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
        note: shift.note,
        bonusIds: shift.bonusIds,
        kind: shift.kind,
      });
      invalidate();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Modifier l'heure d'arrivée"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={save} loading={saving} disabled={delta === 0 && !error}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pt-2">
        <p className="text-[15px] text-ink-3">Vous avez oublié de pointer en arrivant ? Indiquez l'heure à laquelle vous avez réellement commencé.</p>
        <Input
          type="time"
          aria-label="Heure d'arrivée"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-16 text-center text-[32px] font-bold tabular"
        />
        <div className="flex flex-wrap justify-center gap-2">
          {CHIPS.map((c) => (
            <button key={c.label} onClick={() => shiftBy(c.minutes)} className="h-9 rounded-full bg-surface-2 px-4 text-sm font-medium text-ink-2 transition active:scale-95">
              {c.label}
            </button>
          ))}
        </div>
        {!invalid && delta !== 0 && (
          <Notice tone={delta > 0 ? "ok" : "warn"} icon={<Clock3 className="size-4" />}>
            {delta > 0 ? `+ ${formatDuration(delta)} ajoutées à votre journée` : `− ${formatDuration(-delta)} retirées de votre journée`}
          </Notice>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Sheet>
  );
}

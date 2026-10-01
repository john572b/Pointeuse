import { useQuery } from "@tanstack/react-query";
import { CalendarHeart, ChevronLeft, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { api } from "@/lib/api";
import { useInvalidateData, useUser } from "@/lib/hooks";
import { capitalize, longDate } from "@/lib/dates";
import { Button, Card, EmptyState, Field, Input, Notice, PageHeader, Select, Spinner } from "@/components/ui";

interface HolidaysResponse {
  holidays: Array<{ id: string; date: string; name: string }>;
  country: string | null;
  countries: Array<{ code: string; name: string; flag: string }>;
}

export function HolidaysPage() {
  const user = useUser();
  const invalidate = useInvalidateData();
  const [year, setYear] = useState(() => DateTime.now().setZone(user.timezone).year);
  const q = useQuery({ queryKey: ["holidays", year], queryFn: () => api.get<HolidaysResponse>(`/holidays?year=${year}`) });
  const [country, setCountry] = useState<string>("");
  const [form, setForm] = useState({ date: "", name: "" });
  const [msg, setMsg] = useState("");

  const selectedCountry = country || q.data?.country || "LU";

  const importCountry = async () => {
    // Importe l'année affichée ± quelques années pour couvrir l'historique et l'avenir proche.
    const years = Array.from({ length: 6 }, (_, i) => year - 3 + i);
    const r = await api.post<{ added: number }>("/holidays/import", { country: selectedCountry, years });
    setMsg(r.added ? `${r.added} jours fériés ajoutés (${years[0]}–${years[years.length - 1]}).` : "Ces jours fériés sont déjà présents.");
    invalidate();
  };
  const add = async () => {
    if (!form.date || !form.name.trim()) return;
    await api.post("/holidays", form);
    setForm({ date: "", name: "" });
    invalidate();
  };
  const remove = async (id: string) => {
    await api.del(`/holidays/${id}`);
    invalidate();
  };

  return (
    <div className="animate-in">
      <PageHeader title="Jours fériés" subtitle="Les heures travaillées ces jours-là sont majorées selon vos règles." back="/profil" />
      <Card className="space-y-3">
        <p className="font-semibold">Ajouter les jours fériés d'un pays</p>
        <div className="flex gap-2">
          <Select value={selectedCountry} onChange={(e) => setCountry(e.target.value)} aria-label="Pays">
            {q.data?.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </Select>
          <Button onClick={importCountry} className="shrink-0">
            <Download className="size-4" /> Importer
          </Button>
        </div>
        {msg && <Notice tone="ok">{msg}</Notice>}
        <p className="text-xs text-ink-3">Vous pouvez ensuite retirer ou ajouter des jours (fêtes locales, jours offerts par l'employeur…).</p>
      </Card>

      <div className="mt-6 flex items-center justify-between px-1">
        <button onClick={() => setYear(year - 1)} className="grid size-10 place-items-center rounded-full hover:bg-surface" aria-label="Année précédente">
          <ChevronLeft className="size-5" />
        </button>
        <p className="text-lg font-semibold">{year}</p>
        <button onClick={() => setYear(year + 1)} className="grid size-10 place-items-center rounded-full hover:bg-surface" aria-label="Année suivante">
          <ChevronRight className="size-5" />
        </button>
      </div>

      <Card className="mt-3 p-0">
        {q.isLoading ? (
          <Spinner />
        ) : q.data!.holidays.length === 0 ? (
          <EmptyState icon={<CalendarHeart />} title={`Aucun jour férié en ${year}`} text="Importez ceux de votre pays ou ajoutez-les un par un." />
        ) : (
          <ul className="divide-y divide-line">
            {q.data!.holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1">
                  <p className="font-medium">{h.name}</p>
                  <p className="text-sm text-ink-3">{capitalize(longDate(h.date))}</p>
                </div>
                <button onClick={() => remove(h.id)} className="grid size-9 place-items-center rounded-xl text-ink-3 hover:bg-bad-soft hover:text-bad" aria-label={`Retirer ${h.name}`}>
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4 space-y-3">
        <p className="font-semibold">Ajouter un jour</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">{(id) => <Input id={id} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
          <Field label="Nom">{(id) => <Input id={id} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex. : Kermesse" />}</Field>
        </div>
        <Button variant="secondary" onClick={add} disabled={!form.date || !form.name.trim()}>
          <Plus className="size-4" /> Ajouter
        </Button>
      </Card>
    </div>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import type { User } from "@/lib/types";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push";
import { Card, Field, Input, Notice, PageHeader, SectionTitle, Toggle } from "@/components/ui";

export function RemindersPage() {
  const user = useUser();
  const qc = useQueryClient();
  const [pushOn, setPushOn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const prefs = user.prefs;

  useEffect(() => {
    currentSubscription().then((s) => setPushOn(!!s));
  }, []);

  const save = async (patch: Partial<User["prefs"]>) => {
    const r = await api.patch<{ user: User }>("/account/profile", { prefs: patch });
    qc.setQueryData(["me"], r.user);
  };
  const togglePush = async (on: boolean) => {
    setMsg(null);
    if (on) {
      const r = await enablePush().catch((e) => ({ ok: false, reason: e.message as string }));
      setPushOn(r.ok);
      if (!r.ok) setMsg(r.reason ?? "Activation impossible.");
    } else {
      await disablePush();
      setPushOn(false);
    }
  };

  return (
    <div className="animate-in">
      <PageHeader title="Rappels" subtitle="Quelques rappels utiles, jamais de spam." back="/profil" />
      <Card>
        <div className="mb-2 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
            <BellRing className="size-5" />
          </span>
          <p className="text-sm text-ink-3">Chaque rappel n'est envoyé qu'une seule fois, et jamais la nuit sauf si une journée est en cours.</p>
        </div>
        <Toggle label="Notifications sur cet appareil" description={pushSupported() ? undefined : "Sur iPhone : ajoutez d'abord l'app à l'écran d'accueil."} checked={pushOn} onChange={togglePush} />
        {msg && <Notice tone="warn">{msg}</Notice>}
        <Toggle label="Rappels activés" checked={prefs.remindersEnabled} onChange={(v) => save({ remindersEnabled: v })} />
      </Card>

      <SectionTitle>Quand me prévenir</SectionTitle>
      <Card className="space-y-4">
        <ul className="space-y-2 text-sm text-ink-2">
          <li>• « Vous avez commencé votre journée il y a {prefs.reminderLongShiftHours} heures. »</li>
          <li>• « Vous avez peut-être oublié de pointer votre sortie. »</li>
          <li>• « Votre pause dure depuis {prefs.reminderBreakMinutes >= 60 ? `${Math.round(prefs.reminderBreakMinutes / 60)} heure${prefs.reminderBreakMinutes >= 120 ? "s" : ""}` : `${prefs.reminderBreakMinutes} minutes`}. »</li>
          <li>• « Vous avez atteint votre objectif hebdomadaire. »</li>
        </ul>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Journée longue après">
            {(id) => <Input id={id} type="number" min={1} max={24} suffix="h" defaultValue={prefs.reminderLongShiftHours} onBlur={(e) => save({ reminderLongShiftHours: Number(e.target.value) || 9 })} />}
          </Field>
          <Field label="Pause longue après">
            {(id) => <Input id={id} type="number" min={5} max={600} suffix="min" defaultValue={prefs.reminderBreakMinutes} onBlur={(e) => save({ reminderBreakMinutes: Number(e.target.value) || 60 })} />}
          </Field>
        </div>
      </Card>
    </div>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Clock3, ScanFace, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import { biometricAvailable, biometricLabel, registerBiometric } from "@/lib/biometric";
import { useUser } from "@/lib/hooks";
import type { PayRules, User } from "@/lib/types";
import { Button, Field, Input, Notice, Select, cx } from "@/components/ui";

const SLIDES = [
  { icon: Clock3, title: "Pointez en un geste", text: "Un seul bouton : commencer, faire une pause, terminer. Votre temps s'affiche en direct." },
  { icon: Wallet, title: "Votre salaire, estimé", text: "Selon vos propres règles : majorations, nuits, week-ends, jours fériés et primes. Avec le détail du calcul." },
  { icon: BarChart3, title: "Vos tendances", text: "Semaines, mois, années : comprenez l'évolution de votre temps de travail et de vos revenus." },
];

/** Première connexion : présentation très courte, réglages essentiels, puis proposition Face ID. */
export function Welcome() {
  const user = useUser();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [bio, setBio] = useState<boolean | null>(null);
  const rules = useQuery({ queryKey: ["pay-settings"], queryFn: () => api.get<{ rules: PayRules }>("/settings/pay") });
  const [rate, setRate] = useState("");
  const [weekly, setWeekly] = useState("");
  const [country, setCountry] = useState("LU");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setBio);
  }, []);

  const finish = async () => {
    const r = await api.post<{ user: User }>("/account/onboarded");
    qc.setQueryData(["me"], r.user);
    nav("/", { replace: true });
  };

  const saveBasics = async () => {
    setBusy(true);
    setError("");
    try {
      if (rules.data && (rate || weekly)) {
        const w = weekly ? Number(weekly.replace(",", ".")) : rules.data.rules.weeklyHours;
        await api.put("/settings/pay", {
          rules: { ...rules.data.rules, hourlyRate: rate ? Number(rate.replace(",", ".")) : rules.data.rules.hourlyRate, weeklyHours: w, dailyHours: Math.round((w / 5) * 100) / 100 },
          effectiveFrom: null,
        });
      }
      if (country) {
        const y = DateTime.now().year;
        await api.post("/holidays/import", { country, years: [y - 1, y, y + 1, y + 2] });
      }
      if (bio) setStep(4);
      else await finish();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const enableBio = async () => {
    setError("");
    try {
      await registerBiometric();
      await finish();
    } catch (e: any) {
      if (e?.name === "NotAllowedError") return;
      setError(e.message ?? "Activation impossible.");
    }
  };

  return (
    <div className="safe-top flex min-h-dvh flex-col px-6 pb-8 pt-10">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="flex justify-between">
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, ...(bio ? [4] : [])].map((i) => (
              <span key={i} className={cx("h-1.5 rounded-full transition-all", i === step ? "w-6 bg-accent" : "w-1.5 bg-line")} />
            ))}
          </div>
          {step < 3 && (
            <button onClick={() => setStep(3)} className="text-sm font-medium text-ink-3">
              Passer
            </button>
          )}
        </div>

        {step < 3 && (
          <div key={step} className="animate-in flex flex-1 flex-col justify-center text-center">
            {step === 0 && <p className="mb-6 text-lg font-semibold text-ink-3">Bienvenue {user.firstName} 👋</p>}
            {(() => {
              const S = SLIDES[step];
              return (
                <>
                  <span className="mx-auto mb-8 grid size-24 place-items-center rounded-[32px] bg-accent-soft text-accent">
                    <S.icon className="size-11" strokeWidth={1.6} />
                  </span>
                  <h1 className="text-[28px] font-bold tracking-tight">{S.title}</h1>
                  <p className="mt-3 text-[16px] leading-relaxed text-ink-3">{S.text}</p>
                </>
              );
            })()}
          </div>
        )}

        {step === 3 && (
          <div className="animate-in flex flex-1 flex-col justify-center">
            <h1 className="text-[28px] font-bold tracking-tight">L'essentiel</h1>
            <p className="mb-6 mt-2 text-ink-3">Pour estimer votre salaire. Vous pourrez tout affiner plus tard dans Profil.</p>
            <div className="space-y-4">
              <Field label="Taux horaire brut">{(id) => <Input id={id} inputMode="decimal" placeholder={String(rules.data?.rules.hourlyRate ?? 15)} value={rate} onChange={(e) => setRate(e.target.value)} suffix="€/h" />}</Field>
              <Field label="Heures prévues par semaine">{(id) => <Input id={id} inputMode="decimal" placeholder={String(rules.data?.rules.weeklyHours ?? 40)} value={weekly} onChange={(e) => setWeekly(e.target.value)} suffix="h" />}</Field>
              <Field label="Jours fériés">
                {(id) => (
                  <Select id={id} value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="LU">🇱🇺 Luxembourg</option>
                    <option value="FR">🇫🇷 France</option>
                    <option value="BE">🇧🇪 Belgique</option>
                    <option value="CH">🇨🇭 Suisse</option>
                    <option value="DE">🇩🇪 Allemagne</option>
                    <option value="">Aucun pour l'instant</option>
                  </Select>
                )}
              </Field>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="animate-in flex flex-1 flex-col justify-center text-center">
            <span className="mx-auto mb-8 grid size-24 place-items-center rounded-[32px] bg-accent-soft text-accent">
              <ScanFace className="size-12" strokeWidth={1.5} />
            </span>
            <h1 className="text-[28px] font-bold tracking-tight">Activer {biometricLabel()}</h1>
            <p className="mt-3 text-[16px] text-ink-3">Connectez-vous plus rapidement et en toute sécurité.</p>
            <p className="mt-2 text-sm text-ink-3">Vos données biométriques restent sur votre appareil.</p>
          </div>
        )}

        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}

        <div className="space-y-3">
          {step < 3 && (
            <Button size="lg" className="w-full" onClick={() => setStep(step + 1)}>
              Continuer
            </Button>
          )}
          {step === 3 && (
            <Button size="lg" className="w-full" onClick={saveBasics} loading={busy}>
              Continuer
            </Button>
          )}
          {step === 4 && (
            <>
              <Button size="lg" className="w-full" onClick={enableBio}>
                <ScanFace className="size-5" /> Activer
              </Button>
              <Button size="lg" variant="ghost" className="w-full" onClick={finish}>
                Plus tard
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

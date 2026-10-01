import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, ScanFace, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import { biometricAvailable, biometricLabel, registerBiometric, rememberBiometric } from "@/lib/biometric";
import { Button, Card, Field, Input, Notice, PageHeader, SectionTitle } from "@/components/ui";

export function SecurityPage() {
  const qc = useQueryClient();
  const creds = useQuery({ queryKey: ["credentials"], queryFn: () => api.get<{ credentials: Array<{ id: string; name: string; createdAt: number; lastUsedAt: number | null }> }>("/account/credentials") });
  const [available, setAvailable] = useState<boolean | null>(null);
  const [bioMsg, setBioMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [othersMsg, setOthersMsg] = useState("");

  useEffect(() => {
    biometricAvailable().then(setAvailable);
  }, []);

  const addBio = async () => {
    setBioMsg(null);
    try {
      await registerBiometric();
      setBioMsg({ tone: "ok", text: `${biometricLabel()} est activé sur cet appareil.` });
      creds.refetch();
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e: any) {
      if (e?.name === "InvalidStateError") setBioMsg({ tone: "ok", text: "Cet appareil est déjà enregistré." });
      else if (e?.name !== "NotAllowedError") setBioMsg({ tone: "bad", text: e.message ?? "Activation impossible." });
    }
  };
  const removeCred = async (id: string) => {
    await api.del(`/account/credentials/${id}`);
    if ((creds.data?.credentials.length ?? 0) <= 1) rememberBiometric(false);
    creds.refetch();
    qc.invalidateQueries({ queryKey: ["me"] });
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    try {
      await api.post("/account/password", pw);
      setPw({ current: "", next: "" });
      setPwMsg({ tone: "ok", text: "Mot de passe modifié. Vos autres appareils ont été déconnectés." });
    } catch (err: any) {
      setPwMsg({ tone: "bad", text: err.message });
    }
  };
  const logoutOthers = async () => {
    const r = await api.post<{ count: number }>("/account/logout-others");
    setOthersMsg(r.count ? `${r.count} autre${r.count > 1 ? "s" : ""} session${r.count > 1 ? "s" : ""} fermée${r.count > 1 ? "s" : ""}.` : "Aucune autre session ouverte.");
  };

  return (
    <div className="animate-in">
      <PageHeader title="Sécurité" back="/profil" />

      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
            <ScanFace className="size-6" />
          </span>
          <div>
            <p className="font-semibold">Face ID / biométrie</p>
            <p className="text-sm text-ink-3">Connectez-vous plus rapidement et en toute sécurité. Vos données biométriques ne quittent jamais votre appareil.</p>
          </div>
        </div>
        {creds.data && creds.data.credentials.length > 0 && (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {creds.data.credentials.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <Smartphone className="size-5 text-ink-3" />
                <div className="flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-ink-3">
                    Ajouté le {DateTime.fromMillis(c.createdAt).setLocale("fr").toFormat("d LLL yyyy")}
                    {c.lastUsedAt && ` · utilisé le ${DateTime.fromMillis(c.lastUsedAt).setLocale("fr").toFormat("d LLL")}`}
                  </p>
                </div>
                <button onClick={() => removeCred(c.id)} className="grid size-9 place-items-center rounded-xl text-ink-3 hover:bg-bad-soft hover:text-bad" aria-label={`Retirer ${c.name}`}>
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {available === false ? (
          <Notice tone="info">Cet appareil ou ce navigateur ne permet pas la connexion biométrique. Vous pouvez continuer avec votre e-mail et votre mot de passe.</Notice>
        ) : (
          <Button variant="secondary" onClick={addBio} disabled={available === null}>
            <ScanFace className="size-4" /> Activer {available ? biometricLabel() : "la biométrie"} sur cet appareil
          </Button>
        )}
        {bioMsg && <Notice tone={bioMsg.tone}>{bioMsg.text}</Notice>}
      </Card>

      <SectionTitle>Mot de passe</SectionTitle>
      <Card>
        <form onSubmit={changePassword} className="space-y-4">
          <Field label="Mot de passe actuel">{(id) => <Input id={id} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />}</Field>
          <Field label="Nouveau mot de passe" hint="8 caractères minimum.">
            {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />}
          </Field>
          {pwMsg && <Notice tone={pwMsg.tone}>{pwMsg.text}</Notice>}
          <Button type="submit" variant="secondary">
            <KeyRound className="size-4" /> Modifier le mot de passe
          </Button>
        </form>
      </Card>

      <SectionTitle>Sessions</SectionTitle>
      <Card className="space-y-3">
        <p className="text-sm text-ink-3">Vous avez perdu un appareil ? Déconnectez toutes les autres sessions.</p>
        <Button variant="secondary" onClick={logoutOthers}>
          <LogOut className="size-4" /> Déconnecter les autres appareils
        </Button>
        {othersMsg && <Notice tone="ok">{othersMsg}</Notice>}
      </Card>
    </div>
  );
}

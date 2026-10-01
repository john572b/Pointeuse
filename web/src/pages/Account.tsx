import { useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import type { User } from "@/lib/types";
import { Button, Card, Field, Input, Notice, PageHeader, SectionTitle, Select } from "@/components/ui";

const ZONES = (() => {
  try {
    return (Intl as any).supportedValuesOf("timeZone") as string[];
  } catch {
    return ["Europe/Luxembourg", "Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/Berlin", "UTC"];
  }
})();

export function AccountPage() {
  const user = useUser();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [profile, setProfile] = useState({ firstName: user.firstName, timezone: user.timezone });
  const [pMsg, setPMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [email, setEmail] = useState({ email: user.email, password: "" });
  const [eMsg, setEMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [del, setDel] = useState("");
  const [dMsg, setDMsg] = useState("");

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.patch<{ user: User }>("/account/profile", profile);
      qc.setQueryData(["me"], r.user);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      setPMsg({ tone: "ok", text: "Enregistré." });
    } catch (err: any) {
      setPMsg({ tone: "bad", text: err.message });
    }
  };
  const saveEmail = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<{ user: User }>("/account/email", email);
      qc.setQueryData(["me"], r.user);
      setEmail({ ...email, password: "" });
      setEMsg({ tone: "ok", text: "Adresse e-mail modifiée." });
    } catch (err: any) {
      setEMsg({ tone: "bad", text: err.message });
    }
  };
  const deleteAccount = async () => {
    if (!confirm("Supprimer définitivement votre compte et toutes vos données ? Cette action est irréversible.")) return;
    try {
      await api.post("/account/delete", { password: del });
      qc.clear();
      nav("/connexion", { replace: true });
    } catch (err: any) {
      setDMsg(err.message);
    }
  };

  return (
    <div className="animate-in">
      <PageHeader title="Informations" back="/profil" />
      <Card>
        <form onSubmit={saveProfile} className="space-y-4">
          <Field label="Prénom">{(id) => <Input id={id} value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} required />}</Field>
          <Field label="Fuseau horaire" hint="Utilisé pour vos journées, nuits et jours fériés.">
            {(id) => (
              <Select id={id} value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}>
                {ZONES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </Select>
            )}
          </Field>
          {pMsg && <Notice tone={pMsg.tone}>{pMsg.text}</Notice>}
          <Button type="submit">Enregistrer</Button>
        </form>
      </Card>

      <SectionTitle>Adresse e-mail</SectionTitle>
      <Card>
        <form onSubmit={saveEmail} className="space-y-4">
          <Field label="Nouvelle adresse">{(id) => <Input id={id} type="email" value={email.email} onChange={(e) => setEmail({ ...email, email: e.target.value })} required />}</Field>
          <Field label="Mot de passe" hint="Pour confirmer qu'il s'agit bien de vous.">
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={email.password} onChange={(e) => setEmail({ ...email, password: e.target.value })} required />}
          </Field>
          {eMsg && <Notice tone={eMsg.tone}>{eMsg.text}</Notice>}
          <Button type="submit" variant="secondary" disabled={email.email === user.email}>
            Modifier l'e-mail
          </Button>
        </form>
      </Card>

      <SectionTitle>Mes données</SectionTitle>
      <Card className="space-y-4">
        <a href="/api/account/export" download className="flex items-center gap-2 text-[15px] font-medium text-accent">
          <Download className="size-4" /> Télécharger toutes mes données (JSON)
        </a>
        <div className="border-t border-line pt-4">
          <p className="font-medium text-bad">Supprimer mon compte</p>
          <p className="mb-3 text-sm text-ink-3">Toutes vos données seront effacées définitivement.</p>
          <div className="flex gap-2">
            <Input type="password" placeholder="Mot de passe" autoComplete="current-password" value={del} onChange={(e) => setDel(e.target.value)} />
            <Button variant="danger" onClick={deleteAccount} disabled={!del} className="shrink-0">
              <Trash2 className="size-4" /> Supprimer
            </Button>
          </div>
          {dMsg && <p className="mt-2 text-sm text-bad">{dMsg}</p>}
        </div>
      </Card>
    </div>
  );
}

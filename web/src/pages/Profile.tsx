import { useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarHeart, History, LogOut, Moon, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import type { User } from "@/lib/types";
import { applyTheme, type Theme } from "@/lib/theme";
import { Card, ListLink, PageHeader, Segmented, SectionTitle } from "@/components/ui";

export function Profile() {
  const user = useUser();
  const qc = useQueryClient();
  const nav = useNavigate();

  const setTheme = async (theme: Theme) => {
    applyTheme(theme);
    const r = await api.patch<{ user: User }>("/account/profile", { theme });
    qc.setQueryData(["me"], r.user);
  };
  const logout = async () => {
    await api.post("/auth/logout");
    qc.clear();
    nav("/connexion", { replace: true });
  };

  return (
    <div className="animate-in">
      <PageHeader title="Profil" />
      <Card className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-accent text-xl font-bold text-accent-ink">{user.firstName.charAt(0).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="text-lg font-semibold">{user.firstName}</p>
          <p className="truncate text-sm text-ink-3">{user.email}</p>
        </div>
      </Card>

      <SectionTitle>Travail</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden p-0">
        <ListLink to="/profil/remuneration" icon={<Wallet className="size-5" />} label="Rémunération" description="Taux, heures sup., majorations, primes" />
        <ListLink to="/profil/jours-feries" icon={<CalendarHeart className="size-5" />} label="Jours fériés" description="Liste et majoration" />
        <ListLink to="/historique" icon={<History className="size-5" />} label="Historique et export" description="Tous les pointages, CSV, PDF" />
        <ListLink to="/profil/rappels" icon={<Bell className="size-5" />} label="Rappels" description="Notifications discrètes et utiles" />
      </Card>

      <SectionTitle>Compte</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden p-0">
        <ListLink to="/profil/compte" icon={<UserRound className="size-5" />} label="Informations personnelles" description="Prénom, e-mail, fuseau horaire" />
        <ListLink to="/profil/securite" icon={<ShieldCheck className="size-5" />} label="Sécurité" description={user.hasBiometrics ? "Mot de passe · biométrie activée" : "Mot de passe, Face ID / biométrie"} />
      </Card>

      <SectionTitle>Apparence</SectionTitle>
      <Card>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-2">
          <Moon className="size-4" /> Thème
        </div>
        <Segmented
          value={user.theme as Theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "Automatique" },
            { value: "light", label: "Clair" },
            { value: "dark", label: "Sombre" },
          ]}
        />
      </Card>

      <Card className="mt-8 overflow-hidden p-0">
        <ListLink onClick={logout} icon={<LogOut className="size-5" />} label="Se déconnecter" danger />
      </Card>
      <p className="mt-6 text-center text-xs text-ink-3">Pointeuse · pointeuse.boi.lu</p>
    </div>
  );
}

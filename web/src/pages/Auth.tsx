import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, ScanFace } from "lucide-react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { biometricAvailable, biometricLabel, biometricRemembered, loginWithBiometric } from "@/lib/biometric";
import { Button, Field, Input, Notice } from "@/components/ui";

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="safe-top flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="animate-in w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/icon.svg" alt="" className="mb-5 size-16 drop-shadow-lg" />
          <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-ink-3">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="mt-8 text-center text-sm text-ink-3">{footer}</div>}
      </div>
    </div>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-12" />
      <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-3 grid place-items-center px-1 text-ink-3" aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}

function useAuthSuccess() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  return (user: User) => {
    qc.clear();
    qc.setQueryData(["me"], user);
    nav((loc.state as any)?.from ?? "/", { replace: true });
  };
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bio, setBio] = useState(false);
  const done = useAuthSuccess();

  useEffect(() => {
    if (biometricRemembered()) biometricAvailable().then(setBio);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await api.post<{ user: User }>("/auth/login", { email, password });
      done(r.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const withBio = async () => {
    setError("");
    try {
      done(await loginWithBiometric());
    } catch (err: any) {
      if (err?.name !== "NotAllowedError") setError(err.message ?? "Connexion biométrique impossible.");
    }
  };

  return (
    <AuthLayout
      title="Bon retour"
      subtitle="Connectez-vous pour pointer."
      footer={
        <>
          Pas encore de compte ?{" "}
          <Link to="/inscription" className="font-semibold text-accent">
            Créer un compte
          </Link>
        </>
      }
    >
      {bio && (
        <>
          <Button size="lg" className="w-full" onClick={withBio}>
            <ScanFace className="size-5" /> Se connecter avec {biometricLabel()}
          </Button>
          <div className="my-6 flex items-center gap-3 text-xs text-ink-3">
            <span className="h-px flex-1 bg-line" /> ou <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Adresse e-mail">{(id) => <Input id={id} type="email" autoComplete="username webauthn" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Mot de passe">{(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" size="lg" variant={bio ? "secondary" : "primary"} className="w-full" loading={loading}>
          Se connecter
        </Button>
        <p className="text-center">
          <Link to="/mot-de-passe-oublie" className="text-sm font-medium text-ink-3 hover:text-ink">
            Mot de passe oublié ?
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function Register() {
  const [form, setForm] = useState({ firstName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const done = useAuthSuccess();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.password.length < 8) return setError("Le mot de passe doit contenir au moins 8 caractères.");
    setLoading(true);
    try {
      const r = await api.post<{ user: User }>("/auth/register", { ...form, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      done(r.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Créer mon compte"
      subtitle="Votre temps de travail et votre salaire, enfin clairs."
      footer={
        <>
          Déjà inscrit ?{" "}
          <Link to="/connexion" className="font-semibold text-accent">
            Se connecter
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Prénom">{(id) => <Input id={id} autoComplete="given-name" value={form.firstName} onChange={set("firstName")} required />}</Field>
        <Field label="Adresse e-mail">{(id) => <Input id={id} type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set("email")} required />}</Field>
        <Field label="Mot de passe" hint="8 caractères minimum.">
          {(id) => <PasswordInput id={id} autoComplete="new-password" value={form.password} onChange={set("password")} required minLength={8} />}
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Créer mon compte
        </Button>
        <p className="text-center text-xs text-ink-3">Vos données restent privées et ne sont visibles que par vous.</p>
      </form>
    </AuthLayout>
  );
}

export function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/forgot", { email });
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout title="Mot de passe oublié" subtitle="Nous vous envoyons un lien pour en choisir un nouveau." footer={<Link to="/connexion" className="font-semibold text-accent">Retour à la connexion</Link>}>
      {sent ? (
        <Notice tone="ok" icon={<CheckCircle2 className="size-5" />}>
          Si un compte existe pour <b>{email}</b>, un e-mail vient d'être envoyé. Pensez à vérifier vos courriers indésirables.
        </Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Adresse e-mail">{(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
          {error && <Notice tone="bad">{error}</Notice>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Envoyer le lien
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function Reset() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/reset", { token, password });
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisissez un mot de passe d'au moins 8 caractères.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nouveau mot de passe">{(id) => <PasswordInput id={id} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />}</Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!token}>
          Enregistrer
        </Button>
      </form>
    </AuthLayout>
  );
}

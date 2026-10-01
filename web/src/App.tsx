import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMe } from "./lib/hooks";
import { applyTheme, type Theme } from "./lib/theme";
import { AppShell } from "./components/AppShell";
import { Spinner } from "./components/ui";
import { Login, Register, Forgot, Reset } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { ClockPage } from "./pages/Clock";

// Pages secondaires chargées à la demande (premier affichage plus rapide).
const Welcome = lazy(() => import("./pages/Welcome").then((m) => ({ default: m.Welcome })));
const CalendarPage = lazy(() => import("./pages/Calendar").then((m) => ({ default: m.CalendarPage })));
const StatsPage = lazy(() => import("./pages/Stats").then((m) => ({ default: m.StatsPage })));
const HistoryPage = lazy(() => import("./pages/History").then((m) => ({ default: m.HistoryPage })));
const ReportPage = lazy(() => import("./pages/Report").then((m) => ({ default: m.ReportPage })));
const Profile = lazy(() => import("./pages/Profile").then((m) => ({ default: m.Profile })));
const PaySettings = lazy(() => import("./pages/PaySettings").then((m) => ({ default: m.PaySettings })));
const HolidaysPage = lazy(() => import("./pages/Holidays").then((m) => ({ default: m.HolidaysPage })));
const SecurityPage = lazy(() => import("./pages/Security").then((m) => ({ default: m.SecurityPage })));
const AccountPage = lazy(() => import("./pages/Account").then((m) => ({ default: m.AccountPage })));
const RemindersPage = lazy(() => import("./pages/Reminders").then((m) => ({ default: m.RemindersPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <Spinner className="min-h-dvh" />;
  if (!user) return <Navigate to="/connexion" replace state={{ from: loc.pathname }} />;
  if (!user.onboarded && loc.pathname !== "/bienvenue") return <Navigate to="/bienvenue" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useMe();
  if (isLoading) return <Spinner className="min-h-dvh" />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const { data: user } = useMe();
  useEffect(() => {
    if (user) applyTheme(user.theme as Theme);
  }, [user?.theme]);

  return (
    <Suspense fallback={<Spinner className="min-h-dvh" />}>
      <Routes>
        <Route path="/connexion" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/inscription" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/mot-de-passe-oublie" element={<Forgot />} />
        <Route path="/reinitialiser" element={<Reset />} />
        <Route path="/bienvenue" element={<RequireAuth><Welcome /></RequireAuth>} />
        <Route path="/rapport" element={<RequireAuth><ReportPage /></RequireAuth>} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="pointer" element={<ClockPage />} />
          <Route path="calendrier" element={<CalendarPage />} />
          <Route path="statistiques" element={<StatsPage />} />
          <Route path="historique" element={<HistoryPage />} />
          <Route path="profil" element={<Profile />} />
          <Route path="profil/remuneration" element={<PaySettings />} />
          <Route path="profil/jours-feries" element={<HolidaysPage />} />
          <Route path="profil/securite" element={<SecurityPage />} />
          <Route path="profil/compte" element={<AccountPage />} />
          <Route path="profil/rappels" element={<RemindersPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

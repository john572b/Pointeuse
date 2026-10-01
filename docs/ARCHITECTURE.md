# Pointeuse — Analyse & architecture

> Web app de pointage personnelle hébergée sur **https://pointeuse.boi.lu**.
> Règle d'or : **simple en surface, puissant en profondeur.**

---

## 1. Analyse du besoin

| Question de l'utilisateur            | Réponse dans l'app                                   |
| ------------------------------------ | ---------------------------------------------------- |
| Est-ce que je travaille ?            | Pastille de statut en haut du Dashboard              |
| Depuis combien de temps ?            | « Depuis 07:58 » + chrono en temps réel              |
| Combien aujourd'hui / cette semaine ? | Chiffre géant du jour, cartes semaine / mois         |
| Combien ai-je gagné ?                | Carte « Salaire estimé » → détail du calcul          |
| Où en suis-je vs objectif ?          | Anneau de progression hebdomadaire                   |
| Y a-t-il une anomalie ?              | Bandeau discret, uniquement s'il y en a une          |

Un **seul bouton principal** dont le libellé dépend de l'état :

| État        | Bouton principal          | Action secondaire     |
| ----------- | ------------------------- | --------------------- |
| Hors service | COMMENCER MA JOURNÉE     | —                     |
| En service  | TERMINER MA JOURNÉE       | Prendre une pause     |
| En pause    | REPRENDRE LE TRAVAIL      | —                     |

Toute la complexité (règles de paie, jours fériés, corrections, export, rappels,
biométrie) est rangée dans **Profil** et dans les pages secondaires.

---

## 2. Architecture technique

```
┌──────────────────────────── navigateur (mobile first, PWA) ───────────────────────────┐
│  React 19 + Vite + Tailwind v4 · React Router · TanStack Query · Recharts · Lucide    │
│  Service Worker (installable + Web Push)                                              │
└───────────────────────────────▲───────────────────────────────────────────────────────┘
                                │ HTTPS · JSON · cookie de session httpOnly
┌───────────────────────────────┴───────────────────────────────────────────────────────┐
│  Node 20+ · Fastify 5 (un seul processus : API /api/* + fichiers statiques du SPA)      │
│   ├─ auth/        inscription, connexion, sessions, reset, WebAuthn (Face ID)          │
│   ├─ routes/      shifts, absences, holidays, settings, stats, export, push            │
│   ├─ jobs/        rappels intelligents (toutes les 5 min, anti-spam)                   │
│   └─ db/          SQLite (better-sqlite3, WAL) + migrations SQL versionnées            │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                │
                         shared/ (TypeScript pur, testé)
                         ├─ pay/      moteur de calcul du salaire (déterministe)
                         ├─ holidays/ jours fériés par pays (LU, FR, BE, CH, DE)
                         └─ schemas   validation zod partagée client / serveur
```

**Pourquoi ces choix**

* **Un seul déploiement** (un process Node + un fichier SQLite) : facile à héberger
  derrière Caddy/Nginx sur `pointeuse.boi.lu`, sauvegarde = copier un fichier.
* **SQLite** suffit très largement pour un usage individuel ; la couche `server/db/repos`
  isole le SQL pour pouvoir passer à PostgreSQL plus tard (abonnements, multi-instances).
* **Moteur de paie dans `shared/`** : même code côté serveur (stats, export) et côté
  client (aperçu instantané quand on modifie ses règles). Couvert par des tests unitaires.
* **API JSON REST** : une future application mobile (React Native / Capacitor) pourra
  consommer exactement la même API.
* **PWA** : installable sur l'écran d'accueil, notifications push.

---

## 3. Base de données

Tous les instants sont stockés en **UTC (millisecondes epoch)** ; tous les calculs
calendaires (jour, semaine, nuit, férié) se font dans le **fuseau horaire de l'utilisateur**.

```
users ─┬─< sessions
       ├─< password_resets
       ├─< webauthn_credentials
       ├─< auth_challenges          (challenges WebAuthn éphémères)
       ├─< pay_rule_versions        (règles de paie, versionnées dans le temps)
       ├─< shifts ─< breaks         (journées pointées et pauses)
       ├─< absences                 (congés, maladie, récupération…)
       ├─< holidays                 (jours fériés de l'utilisateur)
       ├─< push_subscriptions
       └─< notification_log         (anti-spam des rappels)
```

| Table | Colonnes principales |
| --- | --- |
| `users` | id (uuid), email (unique, normalisé), password_hash (argon2id), first_name, timezone, currency, theme, prefs (JSON : rappels, objectifs…), onboarded_at, biometric_prompted_at, created_at |
| `sessions` | id = **SHA-256 du jeton** (le jeton brut n'est jamais stocké), user_id, expires_at, last_seen_at, user_agent, ip |
| `password_resets` | token_hash, user_id, expires_at (1 h), used_at |
| `webauthn_credentials` | id (credential id), user_id, public_key, counter, transports, name, created_at, last_used_at |
| `auth_challenges` | id, user_id?, challenge, kind (register/login), expires_at |
| `pay_rule_versions` | id, user_id, effective_from (date locale), rules (JSON validé par zod, avec `schemaVersion`) |
| `shifts` | id, user_id, start_at, end_at (NULL = en cours), note, source (clock/manual), edited_at, bonus_ids (JSON, primes manuelles), start_lat/lng/accuracy, end_lat/lng/accuracy *(géoloc. future, NULL)* |
| `breaks` | id, shift_id, start_at, end_at (NULL = pause en cours) |
| `absences` | id, user_id, date, kind (conge/maladie/recup/sans_solde/autre), paid, hours, note |
| `holidays` | id, user_id, date, name, (unique user_id+date) |
| `push_subscriptions` | id, user_id, endpoint, p256dh, auth |
| `notification_log` | user_id, key, sent_at — une clé (`long-shift:<shiftId>`…) n'est jamais envoyée deux fois |

Contraintes clés : index unique partiel `shifts(user_id) WHERE end_at IS NULL`
→ **impossible d'avoir deux journées ouvertes**. Suppression en cascade de toutes
les données à la suppression du compte.

**Règles de paie versionnées** : une augmentation au 1er mars n'altère pas le calcul
de février. Chaque journée est calculée avec la version en vigueur à sa date.

---

## 4. Règles de calcul du salaire

Le document `rules` (JSON) :

```ts
{
  schemaVersion: 1,
  salaryType: "hourly" | "monthly",
  hourlyRate: 15,            // €/h (si mensuel : taux dérivé = mensuel / (h hebdo × 52/12))
  monthlySalary: 2200,
  weeklyHours: 40,           // heures normales / semaine
  dailyHours: 8,             // heures normales / jour
  workdays: [1,2,3,4,5],     // jours habituellement travaillés (ISO : 1 = lundi)
  overtime: { mode: "weekly" | "daily" | "both" | "none", percent: 25 },
  weekdayPercents: { 1:0, 2:0, 3:0, 4:0, 5:0, 6:25, 7:50 },
  night: { enabled: true, start: "22:00", end: "06:00", percent: 25 },
  holidayPercent: 100,
  stacking: "add" | "max",   // cumuler les majorations ou ne garder que la plus forte
  bonuses: [                 // primes personnalisées
    { id, name: "Prime de repas", amount: 9.5, unit: "per_day",   mode: "auto", minHours: 6 },
    { id, name: "Prime de chantier", amount: 20, unit: "per_day", mode: "manual" },
    { id, name: "Prime de transport", amount: 50, unit: "per_month" },
    { id, name: "Prime de nuit (h)", amount: 1.2, unit: "per_hour", mode: "auto" }
  ],
  breakAlertMinutes: 90,
  longShiftHours: 10
}
```

**Algorithme (déterministe, en minutes entières, montants en centimes) :**

1. Pour chaque journée : intervalles travaillés = `[début, fin]` − pauses.
2. Découpage des intervalles à chaque frontière significative : minuit local,
   début/fin de nuit (la plage **22:00 → 06:00 traverse minuit** : elle est gérée en
   testant chaque minute contre `[start, 24h) ∪ [0, end)`).
3. Chaque segment est qualifié : jour ISO, nuit ?, férié ?
4. **Heures supplémentaires** chronologiques : le cumul jour et le cumul semaine
   (semaine ISO, lundi → dimanche) sont suivis ; une minute devient « supplémentaire »
   dès qu'elle dépasse le seuil du mode choisi.
5. Majoration d'un segment = jour de la semaine + nuit + férié + heures sup.
   (somme si `stacking = add`, maximum sinon).
6. Les segments identiques sont regroupés en **lignes de calcul lisibles** :

```
8 h 00 normales            × 15,00 €          = 120,00 €
4 h 00 samedi (+25 %)      × 15,00 € × 1,25   =  75,00 €
2 h 00 dimanche (+50 %)    × 15,00 € × 1,50   =  45,00 €
Prime de repas             × 2 jours          =  19,00 €
Total estimé                                   = 259,00 €
```

7. Congés payés : `heures × taux` (ligne dédiée). Salaire mensuel : la base fixe
   remplace les heures normales ; seuls les suppléments (majorations, heures sup.,
   primes) s'ajoutent.

Le montant est **toujours présenté comme une estimation**, jamais comme une fiche de paie.

---

## 5. Anomalies (calculées, jamais stockées)

| Code | Condition | Couleur calendrier |
| --- | --- | --- |
| `open_shift` | Journée encore ouverte depuis plus de `longShiftHours` ou ouverte un jour précédent | 🔴 |
| `missing_end` | Pause encore ouverte alors que la journée est terminée | 🔴 |
| `long_break` | Pause > `breakAlertMinutes` | 🔴 |
| `missing_day` | Jour habituellement travaillé, passé, sans pointage ni absence (depuis la création du compte) | 🔴 |
| `incomplete` | Journée terminée < 50 % des heures normales du jour | 🟡 |

Calendrier : 🟢 complète · 🟡 incomplète · 🔴 anomalie · 🔵 congé · ⚪ rien.

---

## 6. Pages

| Route | Rôle |
| --- | --- |
| `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reinitialiser` | Authentification |
| `/bienvenue` | Présentation en 3 écrans + prénom + taux horaire + proposition Face ID |
| `/` | **Dashboard** |
| `/pointer` | Écran de pointage plein écran (gros bouton, chrono, frise du jour) |
| `/calendrier` | Vue mensuelle + fiche du jour (détail, édition, congé) |
| `/statistiques` | Filtres de période + KPI + graphiques |
| `/historique` | Tous les pointages, filtres, export CSV / PDF |
| `/profil` | Hub : compte, rémunération, jours fériés, rappels, sécurité, apparence |
| `/profil/remuneration` | Règles de paie (+ aperçu du calcul) |
| `/profil/jours-feries`, `/profil/securite`, `/profil/compte`, `/profil/rappels` | Réglages avancés |

Navigation mobile (barre du bas) : 🏠 Accueil · 🕐 Pointer · 📅 Calendrier · 📊 Stats · 👤 Profil.
Sur grand écran : barre latérale.

---

## 7. Composants réutilisables

`AppShell` (barre nav), `ClockButton` (bouton principal à états), `StatusPill`,
`LiveTimer`, `StatCard`, `ProgressRing`, `DayTimeline` (frise travail/pauses),
`Sheet` (panneau bas mobile / modal desktop), `PayBreakdown` (détail du calcul),
`AnomalyBanner`, `PeriodPicker`, `Field`/`Input`/`Toggle`/`Button`, `EmptyState`,
graphiques `BarChartCard`, `DonutCard`, `LineChartCard`.

---

## 8. Sécurité

* Mots de passe **argon2id** (paramètres OWASP), longueur minimale 8.
* Session : jeton aléatoire 256 bits en cookie `httpOnly; Secure; SameSite=Lax`,
  stocké **haché** en base, expiration glissante 30 jours, révocation à la déconnexion
  et au changement de mot de passe (toutes les autres sessions).
* **CSRF** : SameSite=Lax + vérification de l'en-tête `Origin` sur toute requête
  mutante + en-tête `X-Requested-With` obligatoire.
* **Séparation stricte des comptes** : chaque requête SQL est filtrée par `user_id`
  issu de la session — jamais d'un paramètre client. Une ressource d'un autre
  utilisateur renvoie 404 (pas de fuite d'existence).
* Validation **zod** de toutes les entrées côté serveur.
* Rate limiting sur l'authentification ; message identique que l'e-mail existe ou non
  (inscription exceptée) ; reset par jeton à usage unique valable 1 h.
* WebAuthn (Face ID / Touch ID / Windows Hello) via `@simplewebauthn`, vérification
  utilisateur requise, compteur anti-clonage, RP ID = `pointeuse.boi.lu`.
* En-têtes : Helmet (CSP stricte, HSTS, frame-ancestors none, no-sniff).
* Export et suppression du compte (RGPD).

---

## 9. Évolutivité prévue

| Évolution | Point d'ancrage |
| --- | --- |
| Géolocalisation | colonnes `*_lat/lng/accuracy` déjà présentes ; `prefs.geo` ; l'API de pointage accepte déjà `location` optionnel |
| Abonnements | table `subscriptions` + middleware `requirePlan` ; passage à PostgreSQL via `db/repos` |
| Notifications | Web Push déjà en place, règles dans `server/jobs/reminders.ts` |
| Nouvelles règles de paie | `rules.schemaVersion` + migration de schéma JSON ; moteur modulaire |
| Export avancé | `server/routes/export.ts` (CSV, PDF imprimable) |
| App mobile | API REST JSON ; authentification par cookie ou jeton Bearer |

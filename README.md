# ⏱ Pointeuse

Web app de pointage personnelle — **https://pointeuse.boi.lu**

Simple en surface, puissant en profondeur : un bouton pour pointer, un Dashboard lisible en
quelques secondes, et en coulisses un vrai moteur de calcul du salaire estimé (majorations par jour,
nuit, jours fériés, heures supplémentaires, primes personnalisées), des statistiques sur plusieurs
années, un calendrier, un historique exportable, Face ID / biométrie et des rappels discrets.

L'analyse, l'architecture, le modèle de données, les règles de calcul et les règles de sécurité sont
décrits dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Hébergement : Cloudflare Workers

Tout tourne sur Cloudflare : le Worker sert l'API (`/api/*`) et l'interface (Workers Assets), les
données sont dans une base **D1** (`pointeuse`), un cron envoie les rappels push.

```
shared/      moteur de paie, jours fériés, schémas — partagé client / serveur, testé
server/      Worker (Hono) : auth, WebAuthn, API, rappels push, accès D1
web/         React + Vite + Tailwind : pages, composants, PWA (manifest + service worker)
migrations/  schéma D1 (wrangler d1 migrations)
scripts/     données de démonstration
docs/        architecture
```

## Développement local

```bash
npm install
cp .env.example .dev.vars              # renseigner PASSWORD_PEPPER
npm run db:migrate:local               # crée le schéma dans la D1 locale
npm run seed:demo && npx wrangler d1 execute pointeuse --local --file data/seed-demo.sql   # optionnel
npm run dev                            # Worker sur :8787, interface (rechargement à chaud) sur http://localhost:5173
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Worker local (`wrangler dev`) + interface (Vite) |
| `npm test` | Tests du moteur de paie et de l'API (isolation des comptes, CSRF, validation…) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run build` | Build de l'interface dans `dist/web` |
| `npm run deploy` | Build + `wrangler deploy` |

## Mise en production

Prérequis : la zone `boi.lu` dans le compte Cloudflare (le domaine `pointeuse.boi.lu` est créé
automatiquement par `wrangler deploy` grâce à `routes … custom_domain = true`).

```bash
npx wrangler login                       # ou CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npm run db:migrate                       # applique migrations/ à la base D1 distante
npx wrangler secret put PASSWORD_PEPPER  # openssl rand -base64 48
npx wrangler secret put RESEND_API_KEY   # facultatif : e-mails de réinitialisation
npx wrangler secret put VAPID_PUBLIC_KEY # facultatif : notifications push
npx wrangler secret put VAPID_PRIVATE_KEY
npm run deploy
```

Sauvegarde : `npx wrangler d1 export pointeuse --remote --output sauvegarde.sql`.

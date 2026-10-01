# ⏱ Pointeuse

Web app de pointage personnelle — **https://pointeuse.boi.lu**

Simple en surface, puissant en profondeur : un bouton pour pointer, un Dashboard lisible en
quelques secondes, et en coulisses un vrai moteur de calcul du salaire estimé (majorations par jour,
nuit, jours fériés, heures supplémentaires, primes personnalisées), des statistiques sur plusieurs
années, un calendrier, un historique exportable, Face ID / biométrie et des rappels discrets.

L'analyse, l'architecture, le modèle de données, les règles de calcul et les règles de sécurité sont
décrits dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Démarrage rapide (développement)

```bash
npm install
npm run seed:demo      # optionnel : compte demo@pointeuse.local / demo-pointeuse avec 14 mois d'historique
npm run dev            # API sur :3000, interface sur http://localhost:5173
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | API (tsx watch) + interface (Vite) |
| `npm test` | Tests du moteur de paie et de l'API (isolation des comptes, CSRF, validation…) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run build` | Build de production dans `dist/` |
| `npm start` | Lance le serveur de production (API + interface) |

## Déploiement sur pointeuse.boi.lu

Le DNS de `pointeuse.boi.lu` doit pointer vers le serveur.

```bash
cp .env.example .env   # renseigner SMTP et clés VAPID (npx web-push generate-vapid-keys)
docker compose up -d --build
```

`docker compose` lance l'application et **Caddy**, qui obtient et renouvelle automatiquement le
certificat HTTPS. Les données sont dans le volume `pointeuse-data` (un fichier SQLite :
sauvegarder `/data/pointeuse.db`, par exemple avec `sqlite3 pointeuse.db ".backup backup.db"`).

Sans Docker : `npm ci && npm run build && NODE_ENV=production APP_URL=https://pointeuse.boi.lu npm start`
derrière un reverse proxy HTTPS (obligatoire : cookies `Secure` et WebAuthn exigent HTTPS).

> Après chaque nouveau build, redémarrer le serveur (il garde `index.html` en mémoire).

## Structure

```
shared/   moteur de paie, jours fériés, schémas — partagé client / serveur, testé
server/   Fastify : auth, WebAuthn, API, rappels push, SQLite + migrations
web/      React + Vite + Tailwind : pages, composants, PWA (manifest + service worker)
scripts/  données de démonstration
deploy/   configuration Caddy
docs/     architecture
```

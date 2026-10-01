import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { config } from "../config";
import { HttpError, requireUser } from "../app";
import { uuid } from "../auth/crypto";
import { createSession } from "../auth/session";
import { publicUser, type UserRow } from "../services/data";

/**
 * Face ID / Touch ID / Windows Hello via WebAuthn (passkeys).
 * La clé privée ne quitte jamais l'appareil ; le serveur ne stocke que la clé publique.
 */
export async function webauthnRoutes(app: FastifyInstance) {
  const db = app.db;
  const origins = [...config.allowedOrigins];

  const saveChallenge = (challenge: string, kind: string, userId: string | null) => {
    db.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").run(Date.now());
    const id = uuid();
    db.prepare("INSERT INTO auth_challenges (id, user_id, challenge, kind, expires_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, challenge, kind, Date.now() + 5 * 60_000);
    return id;
  };
  const takeChallenge = (id: string, kind: string) => {
    const row = db.prepare("SELECT user_id, challenge, expires_at FROM auth_challenges WHERE id = ? AND kind = ?").get(id, kind) as
      | { user_id: string | null; challenge: string; expires_at: number }
      | undefined;
    db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(id);
    if (!row || row.expires_at < Date.now()) throw new HttpError(400, "La demande a expiré, réessayez.");
    return row;
  };

  app.post("/auth/webauthn/register/options", async (req) => {
    const user = requireUser(req);
    const existing = db.prepare("SELECT id, transports FROM webauthn_credentials WHERE user_id = ?").all(user.id) as Array<{ id: string; transports: string | null }>;
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: user.email,
      userDisplayName: user.first_name || user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
    });
    const challengeId = saveChallenge(options.challenge, "register", user.id);
    return { options, challengeId };
  });

  app.post("/auth/webauthn/register/verify", async (req) => {
    const user = requireUser(req);
    const body = z.object({ challengeId: z.string(), response: z.any(), name: z.string().trim().max(60).optional() }).parse(req.body);
    const ch = takeChallenge(body.challengeId, "register");
    if (ch.user_id !== user.id) throw new HttpError(400, "Demande invalide.");
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: ch.challenge,
        expectedOrigin: origins,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
    } catch (e: any) {
      throw new HttpError(400, "La vérification biométrique a échoué.");
    }
    if (!verification.verified) throw new HttpError(400, "La vérification biométrique a échoué.");
    const { credential } = verification.registrationInfo;
    db.prepare("INSERT OR REPLACE INTO webauthn_credentials (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      credential.id,
      user.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      body.name || guessDeviceName(req.headers["user-agent"] ?? ""),
      Date.now(),
    );
    return { ok: true };
  });

  app.post("/auth/webauthn/login/options", { config: { rateLimit: { max: 20, timeWindow: "5 minutes" } } }, async () => {
    // Identifiants « découvrables » : l'appareil propose lui-même le compte, pas besoin de saisir l'e-mail.
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: "required", allowCredentials: [] });
    const challengeId = saveChallenge(options.challenge, "login", null);
    return { options, challengeId };
  });

  app.post("/auth/webauthn/login/verify", { config: { rateLimit: { max: 20, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const body = z.object({ challengeId: z.string(), response: z.object({ id: z.string() }).passthrough() }).parse(req.body);
    const ch = takeChallenge(body.challengeId, "login");
    const cred = db.prepare("SELECT * FROM webauthn_credentials WHERE id = ?").get(body.response.id) as
      | { id: string; user_id: string; public_key: Buffer; counter: number; transports: string | null }
      | undefined;
    if (!cred) throw new HttpError(401, "Cet appareil n'est plus reconnu. Connectez-vous avec votre mot de passe.");
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: body.response as any,
        expectedChallenge: ch.challenge,
        expectedOrigin: origins,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        credential: { id: cred.id, publicKey: new Uint8Array(cred.public_key), counter: cred.counter, transports: cred.transports ? JSON.parse(cred.transports) : undefined },
      });
    } catch {
      throw new HttpError(401, "La vérification biométrique a échoué.");
    }
    if (!result.verified) throw new HttpError(401, "La vérification biométrique a échoué.");
    db.prepare("UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?").run(result.authenticationInfo.newCounter, Date.now(), cred.id);
    createSession(db, reply, req, cred.user_id);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(cred.user_id) as UserRow;
    return { user: publicUser(db, user) };
  });

  app.get("/account/credentials", async (req) => {
    const user = requireUser(req);
    const rows = db.prepare("SELECT id, name, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at").all(user.id) as any[];
    return { credentials: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at })) };
  });

  app.delete<{ Params: { id: string } }>("/account/credentials/:id", async (req) => {
    const user = requireUser(req);
    const res = db.prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?").run(req.params.id, user.id);
    if (res.changes === 0) throw new HttpError(404, "Appareil introuvable.");
    return { ok: true };
  });
}

function guessDeviceName(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Appareil";
}

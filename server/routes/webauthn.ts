import { Hono } from "hono";
import { z } from "zod";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { HttpError, body, rateLimit, requireUser, type AppEnv } from "../app";
import { uuid } from "../auth/crypto";
import { createSession } from "../auth/session";
import type { DB } from "../db";
import { getUser, publicUser } from "../services/data";

/**
 * Face ID / Touch ID / Windows Hello via WebAuthn (passkeys).
 * La clé privée ne quitte jamais l'appareil ; le serveur ne stocke que la clé publique.
 */
export function webauthnRoutes() {
  const r = new Hono<AppEnv>();

  const saveChallenge = async (db: DB, challenge: string, kind: string, userId: string | null) => {
    const id = uuid();
    await db.batch([
      ["DELETE FROM auth_challenges WHERE expires_at < ?", [Date.now()]],
      ["INSERT INTO auth_challenges (id, user_id, challenge, kind, expires_at) VALUES (?, ?, ?, ?, ?)", [id, userId, challenge, kind, Date.now() + 5 * 60_000]],
    ]);
    return id;
  };
  const takeChallenge = async (db: DB, id: string, kind: string) => {
    const row = await db.first<{ user_id: string | null; challenge: string; expires_at: number }>("SELECT user_id, challenge, expires_at FROM auth_challenges WHERE id = ? AND kind = ?", id, kind);
    await db.run("DELETE FROM auth_challenges WHERE id = ?", id);
    if (!row || row.expires_at < Date.now()) throw new HttpError(400, "La demande a expiré, réessayez.");
    return row;
  };

  r.post("/auth/webauthn/register/options", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const cfg = c.get("cfg");
    const existing = await db.all<{ id: string; transports: string | null }>("SELECT id, transports FROM webauthn_credentials WHERE user_id = ?", user.id);
    const options = await generateRegistrationOptions({
      rpName: cfg.rpName,
      rpID: cfg.rpId,
      userName: user.email,
      userDisplayName: user.first_name || user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: existing.map((x) => ({ id: x.id, transports: x.transports ? JSON.parse(x.transports) : undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
    });
    return c.json({ options, challengeId: await saveChallenge(db, options.challenge, "register", user.id) });
  });

  r.post("/auth/webauthn/register/verify", async (c) => {
    const user = requireUser(c);
    const db = c.get("db");
    const cfg = c.get("cfg");
    const b = z.object({ challengeId: z.string(), response: z.any(), name: z.string().trim().max(60).optional() }).parse(await body(c));
    const ch = await takeChallenge(db, b.challengeId, "register");
    if (ch.user_id !== user.id) throw new HttpError(400, "Demande invalide.");
    let verification;
    try {
      verification = await verifyRegistrationResponse({ response: b.response, expectedChallenge: ch.challenge, expectedOrigin: cfg.origin, expectedRPID: cfg.rpId, requireUserVerification: true });
    } catch {
      throw new HttpError(400, "La vérification biométrique a échoué.");
    }
    if (!verification.verified) throw new HttpError(400, "La vérification biométrique a échoué.");
    const { credential } = verification.registrationInfo;
    await db.run(
      "INSERT OR REPLACE INTO webauthn_credentials (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      credential.id,
      user.id,
      credential.publicKey,
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      b.name || guessDeviceName(c.req.header("user-agent") ?? ""),
      Date.now(),
    );
    return c.json({ ok: true });
  });

  r.post("/auth/webauthn/login/options", async (c) => {
    await rateLimit(c, "webauthn");
    // Identifiants « découvrables » : l'appareil propose lui-même le compte, pas besoin de saisir l'e-mail.
    const options = await generateAuthenticationOptions({ rpID: c.get("cfg").rpId, userVerification: "required", allowCredentials: [] });
    return c.json({ options, challengeId: await saveChallenge(c.get("db"), options.challenge, "login", null) });
  });

  r.post("/auth/webauthn/login/verify", async (c) => {
    await rateLimit(c, "webauthn");
    const db = c.get("db");
    const cfg = c.get("cfg");
    const b = z.object({ challengeId: z.string(), response: z.object({ id: z.string() }).passthrough() }).parse(await body(c));
    const ch = await takeChallenge(db, b.challengeId, "login");
    const cred = await db.first<{ id: string; user_id: string; public_key: ArrayBuffer | Uint8Array | number[]; counter: number; transports: string | null }>("SELECT * FROM webauthn_credentials WHERE id = ?", b.response.id);
    if (!cred) throw new HttpError(401, "Cet appareil n'est plus reconnu. Connectez-vous avec votre mot de passe.");
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: b.response as any,
        expectedChallenge: ch.challenge,
        expectedOrigin: cfg.origin,
        expectedRPID: cfg.rpId,
        requireUserVerification: true,
        credential: { id: cred.id, publicKey: new Uint8Array(cred.public_key as any), counter: cred.counter, transports: cred.transports ? JSON.parse(cred.transports) : undefined },
      });
    } catch {
      throw new HttpError(401, "La vérification biométrique a échoué.");
    }
    if (!result.verified) throw new HttpError(401, "La vérification biométrique a échoué.");
    await db.run("UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?", result.authenticationInfo.newCounter, Date.now(), cred.id);
    await createSession(db, c, cfg, cred.user_id);
    return c.json({ user: await publicUser(db, await getUser(db, cred.user_id)) });
  });

  r.get("/account/credentials", async (c) => {
    const user = requireUser(c);
    const rows = await c.get("db").all("SELECT id, name, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at", user.id);
    return c.json({ credentials: rows.map((x) => ({ id: x.id, name: x.name, createdAt: x.created_at, lastUsedAt: x.last_used_at })) });
  });

  r.delete("/account/credentials/:id", async (c) => {
    const user = requireUser(c);
    const res = await c.get("db").run("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?", c.req.param("id"), user.id);
    if (res.changes === 0) throw new HttpError(404, "Appareil introuvable.");
    return c.json({ ok: true });
  });

  return r;
}

function guessDeviceName(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Appareil";
}

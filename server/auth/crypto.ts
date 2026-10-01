import { hash, verify } from "@node-rs/argon2";
import crypto from "node:crypto";

// Paramètres argon2id recommandés par l'OWASP (m = 19 MiB, t = 2, p = 1).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, ARGON);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Hash factice pour égaliser le temps de réponse quand l'e-mail n'existe pas. */
let dummy: string | null = null;
export async function burnPasswordTime(password: string) {
  dummy ??= await hashPassword("pointeuse-dummy-password");
  await verifyPassword(dummy, password);
}

export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const uuid = () => crypto.randomUUID();

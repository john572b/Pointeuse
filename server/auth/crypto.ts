/**
 * Primitives cryptographiques sur WebCrypto (disponibles dans Cloudflare Workers).
 *
 * Mots de passe : PBKDF2-HMAC-SHA-512, 100 000 itérations (le maximum autorisé par Workers),
 * sel aléatoire de 16 octets, plus un « poivre » secret côté serveur (PASSWORD_PEPPER) : même
 * en cas de fuite de la base, les hachages ne sont pas attaquables sans le secret.
 */
const ITERATIONS = 100_000;
const te = new TextEncoder();

const b64u = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
};

async function derive(password: string, pepper: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", te.encode(password + "\u0000" + pepper), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt: salt as BufferSource, iterations }, key, 512);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, pepper, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64u.encode(salt)}$${b64u.encode(hash)}`;
}

export async function verifyPassword(stored: string, password: string, pepper: string): Promise<boolean> {
  try {
    const [scheme, iter, salt, hash] = stored.split("$");
    if (scheme !== "pbkdf2") return false;
    const expected = b64u.decode(hash);
    const actual = await derive(password, pepper, b64u.decode(salt), Number(iter));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Dérivation factice pour égaliser le temps de réponse quand l'e-mail n'existe pas. */
export const burnPasswordTime = (password: string, pepper: string) => derive(password, pepper, new Uint8Array(16), ITERATIONS);

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const randomToken = () => b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
export const uuid = () => crypto.randomUUID();

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", te.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

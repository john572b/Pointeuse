import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api } from "./api";
import type { User } from "./types";

/** Face ID / Touch ID / empreinte / Windows Hello disponibles sur cet appareil ? */
export async function biometricAvailable(): Promise<boolean> {
  try {
    return browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable());
  } catch {
    return false;
  }
}

export function biometricLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  if (/Windows/.test(ua)) return "Windows Hello";
  if (/Android/.test(ua)) return "l'empreinte digitale";
  return "la biométrie";
}

const LS_KEY = "biometric-enabled";
export const rememberBiometric = (on: boolean) => {
  try {
    if (on) localStorage.setItem(LS_KEY, "1");
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
};
export const biometricRemembered = () => {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
};

export async function registerBiometric(): Promise<void> {
  const { options, challengeId } = await api.post<{ options: any; challengeId: string }>("/auth/webauthn/register/options");
  const response = await startRegistration({ optionsJSON: options });
  await api.post("/auth/webauthn/register/verify", { challengeId, response });
  rememberBiometric(true);
}

export async function loginWithBiometric(): Promise<User> {
  const { options, challengeId } = await api.post<{ options: any; challengeId: string }>("/auth/webauthn/login/options");
  const response = await startAuthentication({ optionsJSON: options });
  const r = await api.post<{ user: User }>("/auth/webauthn/login/verify", { challengeId, response });
  rememberBiometric(true);
  return r.user;
}

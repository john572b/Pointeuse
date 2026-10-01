import { api } from "./api";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Active les rappels push. Renvoie false si refusé ou non configuré côté serveur. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "Votre navigateur ne prend pas en charge les notifications. Sur iPhone, ajoutez d'abord l'app à l'écran d'accueil." };
  const { publicKey } = await api.get<{ publicKey: string | null }>("/push/key");
  if (!publicKey) return { ok: false, reason: "Les notifications ne sont pas encore activées sur le serveur." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "Autorisation refusée dans le navigateur." };
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api.post("/push/subscribe", sub.toJSON());
  return { ok: true };
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    await api.post("/push/unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}

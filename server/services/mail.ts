import type { Env } from "../env";

/** Envoi d'e-mails via l'API Resend (secret RESEND_API_KEY). Sans clé : message dans les journaux. */
export async function sendMail(env: Env, to: string, subject: string, text: string, html?: string) {
  if (!env.RESEND_API_KEY) {
    console.info(`[mail non envoyé — RESEND_API_KEY absent] À : ${to} · Objet : ${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM ?? "Pointeuse <no-reply@boi.lu>", to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

export function layout(title: string, body: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:20px;padding:32px">
    <div style="font-weight:700;font-size:18px;margin-bottom:24px">⏱ Pointeuse</div>
    <h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
    <p style="font-size:15px;line-height:1.6;color:#444">${body}</p>
    ${cta ? `<a href="${cta.url}" style="display:inline-block;margin-top:16px;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">${cta.label}</a>` : ""}
  </div></body></html>`;
}

import nodemailer from "nodemailer";
import { config } from "../config";

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!config.smtp) {
    // Sans SMTP configuré (développement), le message est affiché dans la console.
    console.info(`\n✉️  [mail non envoyé — SMTP_URL absent]\nÀ : ${to}\nObjet : ${subject}\n\n${text}\n`);
    return;
  }
  transport ??= nodemailer.createTransport(config.smtp.url);
  await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
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

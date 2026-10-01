import { beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app";
import { testDb } from "./test-db";

let app: App;
const env = { APP_URL: "http://localhost:5173", PASSWORD_PEPPER: "test-pepper" } as any;
const H = { "x-requested-with": "pointeuse", origin: "http://localhost:5173" };
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

async function call(method: string, url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await app.request(
    `http://localhost${url}`,
    { method, headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined },
    env,
    ctx,
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non JSON */
  }
  return { status: res.status, json, text, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
}

async function register(email: string) {
  const r = await call("POST", "/api/auth/register", { headers: H, body: { email, password: "motdepasse123", firstName: "Thomas" } });
  expect(r.status).toBe(200);
  return { ...H, cookie: r.cookie! };
}

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400_000).toISOString().slice(0, 10);

beforeAll(() => {
  app = buildApp({ db: testDb() });
});

describe("API", () => {
  it("rejects mutations without the CSRF header or from another origin", async () => {
    expect((await call("POST", "/api/auth/login", { body: { email: "a@b.c", password: "x" } })).status).toBe(403);
    expect((await call("POST", "/api/auth/login", { headers: { ...H, origin: "https://evil.example" }, body: { email: "a@b.c", password: "x" } })).status).toBe(403);
  });

  it("requires authentication", async () => {
    expect((await call("GET", "/api/dashboard")).status).toBe(401);
  });

  it("registers, logs in and refuses duplicates / bad passwords", async () => {
    await register("thomas@example.com");
    expect((await call("POST", "/api/auth/register", { headers: H, body: { email: "THOMAS@example.com", password: "motdepasse123", firstName: "T" } })).status).toBe(409);
    expect((await call("POST", "/api/auth/login", { headers: H, body: { email: "thomas@example.com", password: "wrong-password" } })).status).toBe(401);
    const ok = await call("POST", "/api/auth/login", { headers: H, body: { email: "thomas@example.com", password: "motdepasse123" } });
    expect(ok.status).toBe(200);
    expect(ok.json.user.firstName).toBe("Thomas");
    expect(ok.cookie).toMatch(/^pointeuse_session=/);
  });

  it("clocks in, takes a break and clocks out", async () => {
    const h = await register("clock@example.com");
    let r = await call("POST", "/api/clock/start", { headers: h });
    expect(r.json.status).toBe("working");
    expect((await call("POST", "/api/clock/start", { headers: h })).status).toBe(409);
    r = await call("POST", "/api/clock/break/start", { headers: h });
    expect(r.json.status).toBe("break");
    r = await call("POST", "/api/clock/break/end", { headers: h });
    expect(r.json.status).toBe("working");
    r = await call("POST", "/api/clock/stop", { headers: h });
    expect(r.json.status).toBe("off");
    expect(r.json.recent).toHaveLength(1);
  });

  it("strictly isolates accounts", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const now = Date.now();
    const created = await call("POST", "/api/shifts", { headers: alice, body: { startAt: now - 5 * 3600_000, endAt: now - 3600_000, breaks: [] } });
    expect(created.status).toBe(200);
    const id = created.json.shift.id;
    expect((await call("PUT", `/api/shifts/${id}`, { headers: bob, body: { startAt: now - 4 * 3600_000, endAt: now - 3600_000 } })).status).toBe(404);
    expect((await call("DELETE", `/api/shifts/${id}`, { headers: bob })).status).toBe(404);
    const bobDays = await call("GET", `/api/days?from=${iso(-20)}&to=${iso(0)}`, { headers: bob });
    expect(bobDays.status).toBe(200);
    expect(bobDays.json.days).toHaveLength(0);
    const aliceDays = await call("GET", `/api/days?from=${iso(-2)}&to=${iso(1)}`, { headers: alice });
    expect(aliceDays.json.days.length).toBeGreaterThan(0);
  });

  it("validates manual shifts", async () => {
    const h = await register("valid@example.com");
    const now = Date.now();
    expect((await call("POST", "/api/shifts", { headers: h, body: { startAt: now - 3600_000, endAt: now - 7200_000 } })).status).toBe(400);
    await call("POST", "/api/shifts", { headers: h, body: { startAt: now - 5 * 3600_000, endAt: now - 3 * 3600_000 } });
    expect((await call("POST", "/api/shifts", { headers: h, body: { startAt: now - 4 * 3600_000, endAt: now - 2 * 3600_000 } })).status).toBe(409);
  });

  it("saves pay rules, imports holidays and computes stats", async () => {
    const h = await register("pay@example.com");
    const rules = (await call("GET", "/api/settings/pay", { headers: h })).json.rules;
    expect((await call("PUT", "/api/settings/pay", { headers: h, body: { rules: { ...rules, hourlyRate: 20 }, effectiveFrom: null } })).status).toBe(200);
    const imp = await call("POST", "/api/holidays/import", { headers: h, body: { country: "LU", years: [2026] } });
    expect(imp.json.added).toBe(11);
    const now = Date.now();
    await call("POST", "/api/shifts", { headers: h, body: { startAt: now - 3 * 3600_000, endAt: now - 3600_000 } });
    const d = (await call("GET", "/api/dashboard", { headers: h })).json;
    expect(d.todaySummary.workedMs).toBeGreaterThan(0);
    expect(d.month.amountCents).toBeGreaterThan(0);
    const s = (await call("GET", `/api/stats?from=${iso(-30)}&to=${iso(0)}`, { headers: h })).json;
    expect(s.summary.workedMs).toBe(d.todaySummary.workedMs);
    const csv = await call("GET", `/api/export/csv?from=${iso(-1)}&to=${iso(0)}`, { headers: h });
    expect(csv.text).toContain("Date;Début");
  });

  it("changes the password and logs other sessions out", async () => {
    const h = await register("pw@example.com");
    const other = await call("POST", "/api/auth/login", { headers: H, body: { email: "pw@example.com", password: "motdepasse123" } });
    const otherH = { ...H, cookie: other.cookie! };
    expect((await call("POST", "/api/account/password", { headers: h, body: { current: "wrong", next: "nouveaumdp123" } })).status).toBe(400);
    expect((await call("POST", "/api/account/password", { headers: h, body: { current: "motdepasse123", next: "nouveaumdp123" } })).status).toBe(200);
    expect((await call("GET", "/api/auth/me", { headers: otherH })).status).toBe(401);
    expect((await call("GET", "/api/auth/me", { headers: h })).status).toBe(200);
    expect((await call("POST", "/api/auth/login", { headers: H, body: { email: "pw@example.com", password: "nouveaumdp123" } })).status).toBe(200);
  });
});

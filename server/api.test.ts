import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase } from "./db";
import { buildApp } from "./app";

let app: FastifyInstance;
const H = { "x-requested-with": "pointeuse", origin: "http://localhost:5173" };

async function register(email: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", headers: H, payload: { email, password: "motdepasse123", firstName: "Thomas" } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies[0];
  return { ...H, cookie: `${cookie.name}=${cookie.value}` };
}

beforeAll(async () => {
  app = await buildApp(openDatabase(":memory:"));
});

describe("API", () => {
  it("rejects mutations without the CSRF header or from another origin", async () => {
    const a = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@b.c", password: "x" } });
    expect(a.statusCode).toBe(403);
    const b = await app.inject({ method: "POST", url: "/api/auth/login", headers: { ...H, origin: "https://evil.example" }, payload: { email: "a@b.c", password: "x" } });
    expect(b.statusCode).toBe(403);
  });

  it("requires authentication", async () => {
    expect((await app.inject({ method: "GET", url: "/api/dashboard" })).statusCode).toBe(401);
  });

  it("registers, logs in and refuses duplicates / bad passwords", async () => {
    await register("thomas@example.com");
    const dup = await app.inject({ method: "POST", url: "/api/auth/register", headers: H, payload: { email: "THOMAS@example.com", password: "motdepasse123", firstName: "T" } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { email: "thomas@example.com", password: "wrong-password" } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { email: "thomas@example.com", password: "motdepasse123" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.firstName).toBe("Thomas");
  });

  it("clocks in, takes a break and clocks out", async () => {
    const h = await register("clock@example.com");
    let r = await app.inject({ method: "POST", url: "/api/clock/start", headers: h });
    expect(r.json().status).toBe("working");
    expect((await app.inject({ method: "POST", url: "/api/clock/start", headers: h })).statusCode).toBe(409);
    r = await app.inject({ method: "POST", url: "/api/clock/break/start", headers: h });
    expect(r.json().status).toBe("break");
    r = await app.inject({ method: "POST", url: "/api/clock/break/end", headers: h });
    expect(r.json().status).toBe("working");
    r = await app.inject({ method: "POST", url: "/api/clock/stop", headers: h });
    expect(r.json().status).toBe("off");
    expect(r.json().recent).toHaveLength(1);
  });

  it("strictly isolates accounts", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const now = Date.now();
    const created = await app.inject({ method: "POST", url: "/api/shifts", headers: alice, payload: { startAt: now - 5 * 3600_000, endAt: now - 3600_000, breaks: [] } });
    expect(created.statusCode).toBe(200);
    const id = created.json().shift.id;
    expect((await app.inject({ method: "PUT", url: `/api/shifts/${id}`, headers: bob, payload: { startAt: now - 4 * 3600_000, endAt: now - 3600_000 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/shifts/${id}`, headers: bob })).statusCode).toBe(404);
    const today = new Date().toISOString().slice(0, 10);
    const bobDays = await app.inject({ method: "GET", url: `/api/days?from=${new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 10)}&to=${today}`, headers: bob });
    expect(bobDays.statusCode).toBe(200);
    expect(bobDays.json().days).toHaveLength(0);
    const aliceDays = await app.inject({ method: "GET", url: `/api/days?from=${new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10)}&to=${new Date(Date.now() + 86400_000).toISOString().slice(0, 10)}`, headers: alice });
    expect(aliceDays.json().days.length).toBeGreaterThan(0);
  });

  it("validates manual shifts", async () => {
    const h = await register("valid@example.com");
    const now = Date.now();
    const r = await app.inject({ method: "POST", url: "/api/shifts", headers: h, payload: { startAt: now - 3600_000, endAt: now - 7200_000 } });
    expect(r.statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/shifts", headers: h, payload: { startAt: now - 5 * 3600_000, endAt: now - 3 * 3600_000 } });
    const overlap = await app.inject({ method: "POST", url: "/api/shifts", headers: h, payload: { startAt: now - 4 * 3600_000, endAt: now - 2 * 3600_000 } });
    expect(overlap.statusCode).toBe(409);
  });

  it("saves pay rules and computes stats", async () => {
    const h = await register("pay@example.com");
    const rules = (await app.inject({ method: "GET", url: "/api/settings/pay", headers: h })).json().rules;
    const put = await app.inject({ method: "PUT", url: "/api/settings/pay", headers: h, payload: { rules: { ...rules, hourlyRate: 20 }, effectiveFrom: null } });
    expect(put.statusCode).toBe(200);
    const now = Date.now();
    await app.inject({ method: "POST", url: "/api/shifts", headers: h, payload: { startAt: now - 3 * 3600_000, endAt: now - 3600_000 } });
    const d = (await app.inject({ method: "GET", url: "/api/dashboard", headers: h })).json();
    expect(d.todaySummary.workedMs).toBeGreaterThan(0);
    expect(d.month.amountCents).toBeGreaterThan(0);
  });
});

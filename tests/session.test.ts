import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { userForCookie } from "../src/lib/session";
import { proxy } from "../src/proxy";

const cookie = "__Secure-better-auth.session_token=local-test-only";
const envKeys = ["AUTH_URL", "DMS_URL", "SKIP_AUTH", "NODE_ENV"] as const;
let originalEnv: Partial<Record<typeof envKeys[number], string>>;
let identity: unknown, access: unknown;
let localUser: { name: string | null; role: string } | null;
let requests: { url: string; init?: RequestInit }[], roleReads: number;
const originalFindUser = prisma.user.findFirst;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { AUTH_URL: "https://auth.test/", DMS_URL: "https://dms.test/", SKIP_AUTH: "false", NODE_ENV: "production" });
  identity = { user: { email: "Oemer@autohaus-doerrschuck.de", name: "Ömer", emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60_000).toISOString() } };
  access = { authenticated: true, state: "active" };
  localUser = null; requests = []; roleReads = 0;
  prisma.user.findFirst = (async (args: unknown) => {
    roleReads++;
    assert.deepEqual(args, { where: { email: { equals: "oemer@autohaus-doerrschuck.de", mode: "insensitive" } }, select: { name: true, role: true } });
    return localUser;
  }) as typeof prisma.user.findFirst;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push({ url, init });
    assert.ok(["https://auth.test/api/auth/get-session", "https://dms.test/api/session/status"].includes(url));
    const value = url.startsWith("https://auth.test/") ? identity : access;
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value;
    return Response.json(value);
  };
});

afterEach(() => {
  prisma.user.findFirst = originalFindUser;
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: originalEnv[key] });
  }
});

test("an active DMS user can enter radio without a radio user record", async () => {
  assert.deepEqual(await userForCookie(`unrelated=secret; ${cookie}; ahd_sid=dms-only; forged_role=admin`), {
    email: "oemer@autohaus-doerrschuck.de", name: "Ömer", role: "user",
  });
  assert.equal(roleReads, 1);
  assert.equal(requests.length, 2);
  for (const { init } of requests) {
    assert.deepEqual(init?.headers, { Cookie: cookie });
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
  }
});

test("existing radio admin roles survive but cannot bypass DMS deactivation", async () => {
  localUser = { name: "Existing name", role: "admin" };
  assert.deepEqual(await userForCookie(cookie), { email: "oemer@autohaus-doerrschuck.de", name: "Existing name", role: "admin" });
  access = { authenticated: false, state: "active" };
  assert.equal(await userForCookie(cookie), null);
  assert.equal(roleReads, 1, "no local-role fallback after DMS denial");
});

test("DMS-only device exclusivity does not interrupt radio, explicit revocation does", async () => {
  access = { authenticated: true, state: "superseded" };
  assert.equal((await userForCookie(cookie))?.role, "user");
  access = { authenticated: true, state: "revoked" };
  assert.equal(await userForCookie(cookie), null);
  assert.equal(roleReads, 1);
});

test("a central identity without active DMS access is rejected on every check", async () => {
  assert.ok(await userForCookie(cookie));
  for (const denied of [null, {}, { authenticated: false, state: "active" }, { authenticated: "true", state: "active" }, { authenticated: true }, { authenticated: true, state: "unexpected" }]) {
    access = denied;
    assert.equal(await userForCookie(cookie), null);
  }
  assert.equal(roleReads, 1, "previous authorization must not be cached past deactivation");
});

test("unverified, invalid, missing and expired central sessions never reach DMS", async () => {
  for (const denied of [null, {}, { user: { email: "", emailVerified: true } }, { user: { email: "oemer@autohaus-doerrschuck.de", emailVerified: false } },
    ...["not-a-date", "2020-01-01T00:00:00Z", null, Date.now() + 60_000].map(expiresAt => ({ user: { email: "oemer@autohaus-doerrschuck.de", emailVerified: true }, session: { expiresAt } })),
    new Response(null, { status: 401 }), new Response("not-json"), new Error("network failure")]) {
    identity = denied;
    assert.equal(await userForCookie(cookie), null);
  }
  assert.ok(requests.every(request => request.url.startsWith("https://auth.test/")));
  assert.equal(roleReads, 0);
});

test("DMS outages and malformed responses fail closed without a local admin fallback", async () => {
  localUser = { name: "Existing admin", role: "admin" };
  for (const failed of [new Response(null, { status: 503 }), new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } }), new Response("not-json"), new Error("timeout")]) {
    access = failed;
    assert.equal(await userForCookie(cookie), null);
  }
  assert.equal(roleReads, 0);
});

test("new DMS accounts cannot obtain radio admin privileges from central role claims", async () => {
  (identity as { user: Record<string, unknown> }).user.role = "admin";
  (identity as { user: Record<string, unknown> }).user.isSuperuser = true;
  assert.equal((await userForCookie(cookie))?.role, "user");
  localUser = { name: null, role: "chief" };
  assert.equal((await userForCookie(cookie))?.role, "user");
});

test("production ignores the development bypass in both session and route gates", async () => {
  process.env.SKIP_AUTH = "true";
  assert.equal(await userForCookie(""), null);
  const response = await proxy(new NextRequest("https://radio.doerrschuck.de/api/me"));
  assert.equal(response.status, 401);
  assert.equal(requests.length, 0);
});

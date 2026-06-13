import assert from "node:assert/strict";
import test from "node:test";
import { clientKey, enforceRateLimit } from "./rate-limit";
import { MAX_CONTROL_BODY_BYTES, tooLargeResponse } from "./request-limits";

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) prev[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withEnvAsync<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) prev[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("clientKey ignores proxy headers by default", () => {
  withEnv({ VERCEL: undefined, KEYSARK_TRUST_PROXY_HEADERS: undefined }, () => {
    const req = new Request("https://keysark.test", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.2",
        "x-real-ip": "203.0.113.11",
      },
    });

    assert.equal(clientKey(req), "unknown");
  });
});

test("clientKey uses proxy headers only in trusted proxy mode", () => {
  withEnv({ VERCEL: undefined, KEYSARK_TRUST_PROXY_HEADERS: "1" }, () => {
    const req = new Request("https://keysark.test", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.2",
        "x-real-ip": "203.0.113.11",
      },
    });

    assert.equal(clientKey(req), "203.0.113.10");
  });
});

test("enforceRateLimit falls back to memory when DATABASE_URL is absent", async () => {
  await withEnvAsync({ DATABASE_URL: undefined, VERCEL: undefined, KEYSARK_TRUST_PROXY_HEADERS: undefined }, async () => {
    const bucket = `test-${Date.now()}-${Math.random()}`;
    const req = new Request("https://keysark.test");

    assert.equal(await enforceRateLimit(req, { bucket, limit: 1, windowMs: 60_000 }), null);

    const limited = await enforceRateLimit(req, { bucket, limit: 1, windowMs: 60_000 });
    assert.equal(limited?.status, 429);
    const retryAfter = Number(limited?.headers.get("Retry-After"));
    assert.ok(retryAfter > 0 && retryAfter <= 60);
  });
});

test("tooLargeResponse reports the caller supplied max", async () => {
  const res = tooLargeResponse(MAX_CONTROL_BODY_BYTES);
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: "payload_too_large", max: MAX_CONTROL_BODY_BYTES });
});

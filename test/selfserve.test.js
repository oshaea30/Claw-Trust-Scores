import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PORT = 9876;
let server;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port: PORT,
      path,
      method,
      headers: { "content-type": "application/json", ...headers },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: raw, headers: res.headers });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Self-serve signup routes", () => {
  before(async () => {
    // Set env vars before importing server
    process.env.PORT = String(PORT);
    process.env.DATA_DIR = "./data-test-selfserve";
    process.env.TRUST_API_KEYS = "demo_free_key:free";
    // Don't set Stripe/Resend keys — we're testing the API surface, not external calls

    // Dynamic import so env vars are set first
    const { default: _server } = await import("../src/server.js");
    // Give the server a moment to bind
    await new Promise((r) => setTimeout(r, 200));
  });

  after(() => {
    process.exit(0); // server doesn't export a close handle
  });

  it("POST /v1/users with valid email returns 201", async () => {
    const res = await request("POST", "/v1/users", {
      email: `test-${Date.now()}@example.com`,
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.apiKey, "should return an apiKey");
    assert.equal(res.body.tier, "free");
    assert.ok(res.body.apiKey.startsWith("claw_"), "key should start with claw_");
  });

  it("POST /v1/users with same email returns 200 (idempotent)", async () => {
    const email = `repeat-${Date.now()}@example.com`;

    const first = await request("POST", "/v1/users", { email });
    assert.equal(first.status, 201);

    const second = await request("POST", "/v1/users", { email });
    assert.equal(second.status, 200);
    assert.ok(
      second.body.message.includes("already has an API key"),
      "should clearly indicate the email already has a key"
    );
    assert.equal(second.body.apiKey, undefined, "should not return apiKey for existing email");
  });

  it("POST /v1/users with invalid email returns 400", async () => {
    const res = await request("POST", "/v1/users", { email: "not-an-email" });
    assert.equal(res.status, 400);
  });

  it("POST /v1/users with missing email returns 400", async () => {
    const res = await request("POST", "/v1/users", {});
    assert.equal(res.status, 400);
  });

  it("newly created key works for /v1/score", async () => {
    const signup = await request("POST", "/v1/users", {
      email: `auth-test-${Date.now()}@example.com`,
    });
    assert.equal(signup.status, 201);

    const res = await request(
      "GET",
      "/v1/score?agentId=test-agent",
      null,
      { "x-api-key": signup.body.apiKey }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.agentId, "test-agent");
  });

  it("GET /v1/upgrade/:key without Stripe config returns 503", async () => {
    const signup = await request("POST", "/v1/users", {
      email: `upgrade-test-${Date.now()}@example.com`,
    });

    const res = await request(
      "GET",
      `/v1/upgrade/${signup.body.apiKey}`,
      null
    );
    // Without Stripe price IDs set, should return 503
    assert.equal(res.status, 503);
  });

  it("GET /v1/upgrade/nonexistent returns 404", async () => {
    const res = await request("GET", "/v1/upgrade/claw_doesnotexist", null);
    assert.equal(res.status, 404);
  });

  it("POST /v1/stripe/webhook without signature returns 400", async () => {
    const res = await request("POST", "/v1/stripe/webhook", { type: "test" });
    assert.equal(res.status, 400);
  });

  it("CORS headers are present", async () => {
    const res = await request("GET", "/health", null);
    assert.ok(res.headers["access-control-allow-origin"]);
  });

  it("demo keys still work after key-store refactor", async () => {
    const res = await request(
      "GET",
      "/v1/score?agentId=demo-agent",
      null,
      { "x-api-key": "demo_free_key" }
    );
    assert.equal(res.status, 200);
  });
});

import http from "node:http";
import { URL } from "node:url";

import { authenticate } from "./auth.js";
import { clawCreditPreflight } from "./clawcredit.js";
import { PLANS } from "./config.js";
import { flushStoreToDisk, getPersistenceStatePath, loadStoreFromDisk } from "./persistence.js";
import { getScore, postEvent } from "./service.js";
import { createWebhook, deleteWebhook, getWebhooks } from "./webhooks.js";

const PORT = Number(process.env.PORT ?? 8080);

loadStoreFromDisk();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
      const size = chunks.reduce((acc, item) => acc + item.length, 0);
      if (size > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });

    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, {
      ok: true,
      service: "agent-trust-registry",
      statePath: getPersistenceStatePath()
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/plans") {
    return sendJson(response, 200, { plans: PLANS });
  }

  if (!url.pathname.startsWith("/v1/")) {
    return sendJson(response, 404, { error: "Not Found" });
  }

  const account = authenticate(request);
  if (!account) {
    return sendJson(response, 401, { error: "Unauthorized. Provide a valid x-api-key header." });
  }

  if (request.method === "POST" && url.pathname === "/v1/events") {
    try {
      const payload = await readJsonBody(request);
      const result = await postEvent({ account, payload });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/score") {
    const result = getScore({ account, agentId: url.searchParams.get("agentId") });
    return sendJson(response, result.status, result.body);
  }

  if (request.method === "POST" && url.pathname === "/v1/integrations/clawcredit/preflight") {
    try {
      const payload = await readJsonBody(request);
      const result = clawCreditPreflight({ payload });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/webhooks") {
    try {
      const payload = await readJsonBody(request);
      const result = createWebhook({ account, payload });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/webhooks") {
    const result = getWebhooks({ account });
    return sendJson(response, result.status, result.body);
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/v1/webhooks/")) {
    const webhookId = url.pathname.split("/").pop();
    const result = deleteWebhook({ account, webhookId });
    return sendJson(response, result.status, result.body);
  }

  return sendJson(response, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Agent Trust Registry listening on http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    flushStoreToDisk();
    process.exit(0);
  });
}

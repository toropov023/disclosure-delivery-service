import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { seedSampleData } from "../prisma/seed-data.js";
import {
  messages,
  providerBehavior,
} from "../src/utils/notificationProvider.js";

process.env.DATABASE_URL = ":memory:";
const { prisma } = await import("../src/utils/db.js");
const { app } = await import("../src/app.js");
let server;
let baseUrl;

before(async () => {
  const sql = await readFile(
    new URL(
      "../prisma/migrations/20260930000000_init/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  for (const statement of sql.split(";").filter((part) => part.trim())) {
    await prisma.$executeRawUnsafe(statement);
  }

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  messages.clear();
  providerBehavior.sendError = null;
  providerBehavior.acceptOnTimeout = false;
  providerBehavior.status = "accepted";

  await prisma.deliveryEvent.deleteMany();
  await prisma.delivery.deleteMany();
  await seedSampleData(prisma);
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }

  await prisma.$disconnect();
});

async function request(path, method = "GET", body, userId = "adv-001") {
  const headers = { "Content-Type": "application/json" };

  if (userId !== null) {
    headers["X-User-Id"] = userId;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  return { status: response.status, body: await response.json() };
}

test("HTTP requests send disclosures, refresh status, and return receipt history", async () => {
  const input = {
    clientId: "cl-105",
    fundIds: ["fund-001"],
  };
  const created = await request("/deliveries", "POST", input);

  assert.equal(created.status, 200);
  assert.equal(created.body.length, 1);
  const [delivery] = created.body;
  assert.equal(delivery.status, "ACCEPTED");

  const forbidden = await request(
    `/deliveries/${delivery.id}`,
    "GET",
    undefined,
    "adv-002",
  );
  assert.equal(forbidden.status, 404);

  messages.get(delivery.providerMessageId).status = "delivered";
  const refreshed = await request(`/deliveries/${delivery.id}`);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.status, "DELIVERED");

  const history = await request(
    `/clients/cl-105/disclosures?asOf=${encodeURIComponent(refreshed.body.receivedAt)}`,
    "GET",
    undefined,
    "cmp-001",
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.length, 1);
  assert.equal(history.body[0].documentId, "doc-001");
  assert.equal(
    history.body[0].documentVersion,
    delivery.disclosureDocumentVersion,
  );

  const repeated = await request("/deliveries", "POST", input);
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body, []);
  assert.equal(messages.size, 1);
});

test("HTTP retry reuses a pending delivery and rejects retrying an accepted one", async () => {
  providerBehavior.sendError = "TRANSIENT";
  const created = await request("/deliveries", "POST", {
    clientId: "cl-105",
    fundIds: ["fund-001"],
  });
  const [delivery] = created.body;
  assert.equal(created.status, 200);
  assert.equal(delivery.status, "PENDING");

  providerBehavior.sendError = null;
  const retried = await request(`/deliveries/${delivery.id}/retry`, "POST");
  assert.equal(retried.status, 200);
  assert.equal(retried.body.id, delivery.id);
  assert.equal(retried.body.status, "ACCEPTED");
  assert.equal(messages.size, 1);

  const rejected = await request(`/deliveries/${delivery.id}/retry`, "POST");
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /Only pending or unknown/);
});

test("HTTP validation and access failures return JSON errors", async () => {
  // Legacy body/query IDs do not replace the required caller header.
  for (const [path, method, body] of [
    [
      "/deliveries",
      "POST",
      { advisorId: "adv-001", clientId: "cl-105", fundIds: ["fund-001"] },
    ],
    ["/deliveries/missing?advisorId=adv-001", "GET"],
    ["/deliveries/missing/retry", "POST", { advisorId: "adv-001" }],
    [
      "/clients/cl-101/disclosures?userId=cmp-001&asOf=2026-09-30T12:00:00Z",
      "GET",
    ],
  ]) {
    const missingHeader = await request(path, method, body, null);
    assert.equal(missingHeader.status, 400);
    assert.equal(missingHeader.body.error, "X-User-Id header is required.");
  }

  const missingInput = await request("/deliveries", "POST", {});
  assert.equal(missingInput.status, 400);
  assert.match(missingInput.body.error, /Client ID/);

  const invalidId = await request("/deliveries", "POST", {
    clientId: {},
    fundIds: ["fund-001"],
  });
  assert.equal(invalidId.status, 400);

  // A body or query ID cannot override the caller identified by the header.
  const forbidden = await request(
    "/deliveries",
    "POST",
    {
      advisorId: "adv-001",
      clientId: "cl-105",
      fundIds: ["fund-001"],
    },
    "adv-002",
  );
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.body.error, /their own clients/);

  const invalidFunds = await request("/deliveries", "POST", {
    clientId: "cl-105",
    fundIds: [],
  });
  assert.equal(invalidFunds.status, 400);
  assert.equal(messages.size, 0);

  const invalidDate = await request(
    "/clients/cl-101/disclosures?asOf=invalid",
    "GET",
    undefined,
    "cmp-001",
  );
  assert.equal(invalidDate.status, 400);
  assert.match(invalidDate.body.error, /as-of date/);

  const forbiddenHistory = await request(
    "/clients/cl-101/disclosures?userId=cmp-001&asOf=2026-09-30T12:00:00Z",
    "GET",
    undefined,
    "adv-002",
  );
  assert.equal(forbiddenHistory.status, 403);

  const missingDelivery = await request("/deliveries/missing");
  assert.equal(missingDelivery.status, 404);
  assert.match(missingDelivery.body.error, /not found or not accessible/);

  const malformed = await fetch(`${baseUrl}/deliveries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": "adv-001" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: "Request body must be valid JSON.",
  });

  const missingRoute = await request("/missing");
  assert.deepEqual(missingRoute, {
    status: 404,
    body: { error: "Route not found." },
  });
});

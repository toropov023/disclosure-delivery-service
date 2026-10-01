import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { seedSampleData } from "../prisma/seed-data.js";
import {
  messages,
  providerBehavior,
  transientFailures,
} from "../src/utils/notificationProvider.js";

const defaultProviderStatus = providerBehavior.status;

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
  transientFailures.clear();
  providerBehavior.sendError = null;
  providerBehavior.acceptOnTimeout = false;
  providerBehavior.status = defaultProviderStatus;

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

test("HTTP demo accepts two documents, records delivery and bounce, and includes only receipts", async () => {
  const input = {
    clientId: "cl-105",
    fundIds: ["fund-001", "fund-002"],
  };
  const created = await request("/deliveries", "POST", input);

  assert.equal(created.status, 200);
  assert.equal(created.body.length, 2);
  const delivery = created.body.find((item) => item.fundId === "fund-001");
  const bounced = created.body.find((item) => item.fundId === "fund-002");
  assert.equal(delivery.fundId, "fund-001");
  assert.equal(delivery.status, "ACCEPTED");
  assert.equal(delivery.receivedAt, null);
  assert.equal(bounced.status, "ACCEPTED");
  assert.equal(bounced.receivedAt, null);

  const initialEventCount = await prisma.deliveryEvent.count();
  const initialDeliveryCount = await prisma.delivery.count();

  for (let attempt = 0; attempt < 3; attempt++) {
    const repeated = await request("/deliveries", "POST", input);
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body, created.body);
  }

  assert.equal(messages.size, 2);
  assert.equal(await prisma.delivery.count(), initialDeliveryCount);
  assert.equal(await prisma.deliveryEvent.count(), initialEventCount);

  const refreshed = await request(`/deliveries/${delivery.id}`);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.status, "DELIVERED");

  const failed = await request(`/deliveries/${bounced.id}`);
  assert.equal(failed.status, 200);
  assert.equal(failed.body.status, "BOUNCED");
  assert.equal(failed.body.receivedAt, null);
  assert.equal(messages.size, 2);

  const eventCount = await prisma.deliveryEvent.count();
  assert.deepEqual(
    (await request(`/deliveries/${delivery.id}`)).body,
    refreshed.body,
  );
  assert.deepEqual(
    (await request(`/deliveries/${bounced.id}`)).body,
    failed.body,
  );
  assert.equal(await prisma.deliveryEvent.count(), eventCount);

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

  const repeated = await request("/deliveries", "POST", {
    ...input,
    fundIds: ["fund-001"],
  });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body, []);
  assert.equal(messages.size, 2);

  const replacement = await request("/deliveries", "POST", input);
  assert.equal(replacement.status, 200);
  assert.equal(replacement.body.length, 1);
  assert.equal(replacement.body[0].fundId, "fund-002");
  assert.equal(replacement.body[0].status, "ACCEPTED");
  assert.notEqual(replacement.body[0].id, bounced.id);
  assert.equal(messages.size, 3);

  const reused = await request("/deliveries", "POST", input);
  assert.equal(reused.status, 200);
  assert.deepEqual(reused.body, replacement.body);
  assert.equal(messages.size, 3);
});

test("HTTP fund-003 demo retries the same pending delivery and records its receipt", async () => {
  const input = {
    clientId: "cl-105",
    fundIds: ["fund-001", "fund-002", "fund-003"],
  };
  const created = await request("/deliveries", "POST", input);
  assert.equal(created.status, 200);
  assert.deepEqual(
    created.body.map(({ status }) => status),
    ["ACCEPTED", "ACCEPTED", "PENDING"],
  );
  const pending = created.body.find(({ fundId }) => fundId === "fund-003");
  assert.equal(pending.providerMessageId, null);
  assert.equal(messages.size, 2);
  assert.deepEqual(
    (await request("/deliveries", "POST", input)).body,
    created.body,
  );
  const eventsBeforeCheck = await prisma.deliveryEvent.count();
  assert.equal(
    (await request(`/deliveries/${pending.id}`)).body.status,
    "PENDING",
  );
  assert.equal(await prisma.deliveryEvent.count(), eventsBeforeCheck);

  const countBeforeRetry = await prisma.delivery.count();
  const retried = await request(`/deliveries/${pending.id}/retry`, "POST");
  assert.equal(retried.status, 200);
  assert.equal(retried.body.id, pending.id);
  assert.equal(retried.body.status, "ACCEPTED");
  assert.equal(retried.body.attemptCount, 2);
  assert.equal(retried.body.receivedAt, null);
  assert.equal(
    messages.get(retried.body.providerMessageId).idempotencyKey,
    pending.id,
  );
  assert.equal(messages.size, 3);
  assert.equal(await prisma.delivery.count(), countBeforeRetry);

  const rejected = await request(`/deliveries/${pending.id}/retry`, "POST");
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /Only pending or unknown/);
  assert.equal(messages.size, 3);

  for (const delivery of created.body) {
    const checked = await request(`/deliveries/${delivery.id}`);
    assert.equal(
      checked.body.status,
      delivery.fundId === "fund-002" ? "BOUNCED" : "DELIVERED",
    );
  }

  const history = await request(
    `/clients/cl-105/disclosures?asOf=${encodeURIComponent(new Date().toISOString())}`,
    "GET",
    undefined,
    "cmp-001",
  );
  assert.equal(history.status, 200);
  assert.deepEqual(
    history.body.map(({ documentId }) => documentId),
    ["doc-001", "doc-003"],
  );
});

test("HTTP caller headers and invalid requests enforce access and return JSON errors", async () => {
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
});

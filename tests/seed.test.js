import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.ts";
import sampleData from "../docs/Send to Candidate_sample-data.json" with { type: "json" };
import { seedSampleData } from "../prisma/seed-data.js";

async function createTestDatabase(t) {
  // Always use a fresh in-memory database, ignoring the application's DATABASE_URL.
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: ":memory:" }),
  });
  t.after(() => prisma.$disconnect());

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

  return prisma;
}

test("imports the complete sample, its edge cases, and historical receipt evidence", async (t) => {
  const prisma = await createTestDatabase(t);
  await seedSampleData(prisma);

  assert.equal(await prisma.user.count(), 4);
  assert.equal(await prisma.client.count(), 7);
  assert.equal(await prisma.fund.count(), 4);
  assert.equal(await prisma.disclosureDocument.count(), 8);
  assert.equal(await prisma.delivery.count(), 6);
  assert.equal(await prisma.deliveryEvent.count(), 6);

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: "cl-104" },
  });
  assert.equal(client.email, "marc.gagnon@");
  assert.equal(client.advisorId, "adv-001");

  const futureVersion = await prisma.disclosureDocument.findUniqueOrThrow({
    where: { id_version: { id: "doc-004", version: 2 } },
  });
  assert.equal(
    futureVersion.publishedAt.toISOString(),
    "2027-01-15T09:00:00.000Z",
  );

  for (const history of sampleData.delivery_history) {
    const delivery = await prisma.delivery.findUniqueOrThrow({
      where: { providerMessageId: history.provider_message_id },
    });
    const event = await prisma.deliveryEvent.findFirstOrThrow({
      where: { deliveryId: delivery.id },
    });
    const sentAt = new Date(history.sent_at);
    const receivedAt = history.status === "delivered" ? sentAt : null;

    assert.equal(delivery.clientId, history.client_id);
    assert.equal(delivery.disclosureDocumentId, history.document_id);
    assert.equal(delivery.disclosureDocumentVersion, history.version);
    assert.equal(delivery.status, history.status.toUpperCase());
    assert.deepEqual(delivery.sentAt, sentAt);
    assert.deepEqual(delivery.receivedAt, receivedAt);
    assert.equal(delivery.firstAttemptAt, null);
    assert.equal(delivery.attemptCount, 0);

    assert.equal(event.advisorId, "user-legacy");
    assert.equal(event.clientId, history.client_id);
    assert.equal(event.clientName, "Legacy (unknown)");
    assert.equal(event.recipientEmail, "legacy@unknown.invalid");
    assert.equal(event.documentId, history.document_id);
    assert.equal(event.documentVersion, history.version);
    assert.deepEqual(event.sentAt, sentAt);
    assert.deepEqual(event.receivedAt, receivedAt);
    assert.match(
      event.detail,
      receivedAt ? /assumed to equal sent_at/ : /bounced/,
    );
  }

  const receipts = await prisma.deliveryEvent.findMany({
    where: { receivedAt: { lte: new Date("2026-03-06T00:00:00Z") } },
    orderBy: { receivedAt: "asc" },
  });
  assert.deepEqual(
    receipts.map((event) => event.providerMessageId),
    ["msg-hist-0001", "msg-hist-0002"],
  );
});

test("reruns preserve edits and audit history without recreating deleted deliveries", async (t) => {
  const prisma = await createTestDatabase(t);
  await seedSampleData(prisma);

  const editedClient = await prisma.client.update({
    where: { id: "cl-101" },
    data: { name: "Updated name", advisorId: "adv-002" },
  });
  const editedDelivery = await prisma.delivery.update({
    where: { providerMessageId: "msg-hist-0001" },
    data: { requestId: "updated-request" },
  });
  const eventsBefore = await prisma.deliveryEvent.findMany({
    orderBy: { id: "asc" },
  });

  await seedSampleData(prisma);

  assert.equal(await prisma.delivery.count(), 6);
  assert.equal(await prisma.user.count(), 4);
  assert.equal(await prisma.disclosureDocument.count(), 8);
  assert.deepEqual(
    await prisma.client.findUnique({ where: { id: editedClient.id } }),
    editedClient,
  );
  assert.deepEqual(
    await prisma.delivery.findUnique({ where: { id: editedDelivery.id } }),
    editedDelivery,
  );
  assert.deepEqual(
    await prisma.deliveryEvent.findMany({ orderBy: { id: "asc" } }),
    eventsBefore,
  );

  await prisma.delivery.delete({ where: { id: editedDelivery.id } });
  await seedSampleData(prisma);

  assert.equal(await prisma.delivery.count(), 5);
  assert.deepEqual(
    await prisma.deliveryEvent.findMany({ orderBy: { id: "asc" } }),
    eventsBefore,
  );
});

test("a bad history reference rolls back the entire import", async (t) => {
  const prisma = await createTestDatabase(t);
  const data = structuredClone(sampleData);
  data.delivery_history.at(-1).client_id = "missing-client";

  await assert.rejects(seedSampleData(prisma, data), { code: "P2003" });

  for (const model of [
    "user",
    "client",
    "fund",
    "disclosureDocument",
    "delivery",
    "deliveryEvent",
  ]) {
    assert.equal(await prisma[model].count(), 0);
  }
});

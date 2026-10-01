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

test("imports every past delivery with its original version, status, and receipt evidence", async (t) => {
  const prisma = await createTestDatabase(t);
  await seedSampleData(prisma);

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
    assert.equal(event.clientId, history.client_id);
    assert.equal(event.documentId, history.document_id);
    assert.equal(event.documentVersion, history.version);
    assert.equal(event.providerMessageId, history.provider_message_id);
    assert.equal(event.status, history.status.toUpperCase());
    assert.deepEqual(event.sentAt, sentAt);
    assert.deepEqual(event.receivedAt, receivedAt);
    assert.match(
      event.detail,
      receivedAt ? /assumed to equal sent_at/ : /bounced/,
    );
  }
});

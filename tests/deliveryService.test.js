import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { seedSampleData } from "../prisma/seed-data.js";
import {
  messages,
  providerBehavior,
} from "../src/utils/notificationProvider.js";

// Keep every database operation in this test process in memory.
process.env.DATABASE_URL = ":memory:";
const { prisma } = await import("../src/utils/db.js");
const { deliverDisclosures, getDeliveryStatus, retryDelivery } =
  await import("../src/services/deliveryService.js");
const { getReceivedDisclosures } =
  await import("../src/services/disclosureService.js");

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
});

beforeEach(async () => {
  messages.clear();
  providerBehavior.sendError = null;
  providerBehavior.acceptOnTimeout = false;
  providerBehavior.status = "accepted";

  await prisma.deliveryEvent.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.disclosureDocument.deleteMany();
  await prisma.fund.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();
  await seedSampleData(prisma);
});

after(() => prisma.$disconnect());

test("sends missing current versions and respects delivered or bounced sample history", async () => {
  await prisma.disclosureDocument.update({
    where: { id_version: { id: "doc-004", version: 2 } },
    data: { publishedAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });

  const deliveries = await deliverDisclosures("adv-001", "cl-101", [
    "fund-001",
    "fund-002",
    "fund-004",
  ]);

  assert.deepEqual(
    deliveries.map(({ disclosureDocumentId, disclosureDocumentVersion }) => [
      disclosureDocumentId,
      disclosureDocumentVersion,
    ]),
    [
      ["doc-001", 3],
      ["doc-004", 1],
    ],
  );
  assert.equal(deliveries[0].requestId, deliveries[1].requestId);
  assert.equal(messages.size, 2);

  for (const delivery of deliveries) {
    assert.equal(delivery.status, "ACCEPTED");
    assert.equal(delivery.attemptCount, 1);
    assert.ok(delivery.sentAt instanceof Date);
    assert.equal(delivery.receivedAt, null);
    const message = messages.get(delivery.providerMessageId);
    assert.equal(message.idempotencyKey, delivery.id);
    assert.equal(message.recipientEmail, "elena.novak@example.test");
    assert.equal(message.documentId, delivery.disclosureDocumentId);
    assert.equal(message.version, delivery.disclosureDocumentVersion);
  }

  // A receipt of the current version means nothing needs sending.
  assert.deepEqual(
    await deliverDisclosures("adv-002", "cl-201", ["fund-001"]),
    [],
  );
  assert.equal(messages.size, 2);

  // The sample's bounced current version must still be sent.
  const [replacement] = await deliverDisclosures("adv-001", "cl-102", [
    "fund-002",
  ]);
  assert.equal(replacement.disclosureDocumentId, "doc-002");
  assert.equal(replacement.disclosureDocumentVersion, 1);
  assert.equal(replacement.status, "ACCEPTED");
  assert.notEqual(replacement.providerMessageId, "msg-hist-0006");
  assert.equal(messages.size, 3);
});

test("repeated requests reuse active deliveries, skip receipts, and replace bounces", async () => {
  const deliveries = await deliverDisclosures("adv-001", "cl-105", [
    "fund-001",
    "fund-002",
  ]);
  const repeated = await deliverDisclosures("adv-001", "cl-105", [
    "fund-001",
    "fund-002",
  ]);
  assert.deepEqual(repeated, deliveries);
  assert.equal(messages.size, 2);

  // A new request skips a newly confirmed receipt and replaces a newly found bounce.
  messages.get(deliveries[0].providerMessageId).status = "delivered";
  messages.get(deliveries[1].providerMessageId).status = "bounced";

  const replacements = await deliverDisclosures("adv-001", "cl-105", [
    "fund-001",
    "fund-002",
  ]);

  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].disclosureDocumentId, "doc-002");
  assert.equal(replacements[0].status, "ACCEPTED");
  assert.notEqual(replacements[0].id, deliveries[1].id);
  assert.equal(messages.size, 3);
  assert.equal(
    (await getDeliveryStatus("adv-001", deliveries[1].id)).status,
    "BOUNCED",
  );
});

test("a newly published version is sent even after the previous version was received", async () => {
  await prisma.disclosureDocument.update({
    where: { id_version: { id: "doc-004", version: 2 } },
    data: { publishedAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });

  const [original] = await deliverDisclosures("adv-001", "cl-105", [
    "fund-004",
  ]);
  assert.equal(original.disclosureDocumentVersion, 1);

  messages.get(original.providerMessageId).status = "delivered";
  await getDeliveryStatus("adv-001", original.id);
  assert.deepEqual(
    await deliverDisclosures("adv-001", "cl-105", ["fund-004"]),
    [],
  );
  assert.equal(messages.size, 1);

  await prisma.disclosureDocument.update({
    where: { id_version: { id: "doc-004", version: 2 } },
    data: { publishedAt: new Date() },
  });

  const [updated] = await deliverDisclosures("adv-001", "cl-105", ["fund-004"]);
  assert.equal(updated.disclosureDocumentId, original.disclosureDocumentId);
  assert.equal(updated.disclosureDocumentVersion, 2);
  assert.equal(updated.status, "ACCEPTED");
  assert.notEqual(updated.id, original.id);
  assert.equal(messages.size, 2);

  const originalMessage = messages.get(original.providerMessageId);
  const updatedMessage = messages.get(updated.providerMessageId);
  assert.equal(originalMessage.version, 1);
  assert.equal(updatedMessage.version, 2);
  assert.equal(updatedMessage.idempotencyKey, updated.id);
  assert.notEqual(
    updatedMessage.idempotencyKey,
    originalMessage.idempotencyKey,
  );

  // Acceptance of version 2 must not become receipt evidence for version 2.
  const history = await getReceivedDisclosures("cmp-001", "cl-105", new Date());
  assert.deepEqual(
    history.map(({ documentVersion }) => documentVersion),
    [1],
  );
});

test("records delivered and bounced outcomes and preserves receipt history", async () => {
  const [first, second] = await deliverDisclosures("adv-001", "cl-105", [
    "fund-001",
    "fund-002",
  ]);

  assert.equal(
    (await getDeliveryStatus("adv-001", first.id)).status,
    "ACCEPTED",
  );
  assert.deepEqual(
    await getReceivedDisclosures("cmp-001", "cl-105", new Date()),
    [],
  );

  messages.get(first.providerMessageId).status = "delivered";
  messages.get(second.providerMessageId).status = "bounced";
  const delivered = await getDeliveryStatus("adv-001", first.id);
  const bounced = await getDeliveryStatus("adv-001", second.id);

  assert.equal(delivered.status, "DELIVERED");
  assert.ok(delivered.receivedAt instanceof Date);
  assert.equal(bounced.status, "BOUNCED");
  assert.equal(bounced.receivedAt, null);
  assert.deepEqual(
    await getReceivedDisclosures(
      "cmp-001",
      "cl-105",
      new Date(delivered.receivedAt.getTime() - 1),
    ),
    [],
  );

  const history = await getReceivedDisclosures(
    "cmp-001",
    "cl-105",
    delivered.receivedAt,
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].documentId, "doc-001");
  assert.equal(history[0].documentVersion, 3);

  const events = await prisma.deliveryEvent.findMany({
    where: { deliveryId: first.id },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(
    events.map(({ status }) => status),
    ["PENDING", "UNKNOWN", "ACCEPTED", "DELIVERED"],
  );

  // Changing live data and checking status again must not rewrite old events.
  await prisma.client.update({
    where: { id: "cl-105" },
    data: { name: "Updated name", email: "updated@example.test" },
  });
  await prisma.fund.update({
    where: { id: "fund-001" },
    data: { name: "Updated fund" },
  });
  await getDeliveryStatus("adv-001", first.id);
  assert.deepEqual(
    await prisma.deliveryEvent.findMany({
      where: { deliveryId: first.id },
      orderBy: { id: "asc" },
    }),
    events,
  );
  assert.deepEqual(
    await getReceivedDisclosures("cmp-001", "cl-105", delivered.receivedAt),
    history,
  );
  assert.deepEqual(
    await deliverDisclosures("adv-001", "cl-105", ["fund-001"]),
    [],
  );
});

test("only the client's advisor can send, check, or retry deliveries", async () => {
  for (const advisorId of ["adv-002", "cmp-001"]) {
    await assert.rejects(
      deliverDisclosures(advisorId, "cl-105", ["fund-001"]),
      /their own clients/,
    );
  }
  assert.equal(messages.size, 0);

  const [delivery] = await deliverDisclosures("adv-001", "cl-105", [
    "fund-001",
  ]);

  for (const advisorId of ["adv-002", "cmp-001"]) {
    await assert.rejects(
      getDeliveryStatus(advisorId, delivery.id),
      /not accessible/,
    );
    await assert.rejects(
      retryDelivery(advisorId, delivery.id),
      /not accessible/,
    );
  }
});

test("a transient error can be retried using the same delivery", async () => {
  providerBehavior.sendError = "TRANSIENT";
  const [pending] = await deliverDisclosures("adv-001", "cl-105", ["fund-001"]);

  assert.equal(pending.status, "PENDING");
  assert.equal(messages.size, 0);
  assert.deepEqual(
    await getReceivedDisclosures("cmp-001", "cl-105", new Date()),
    [],
  );

  providerBehavior.sendError = null;
  const accepted = await retryDelivery("adv-001", pending.id);

  assert.equal(accepted.id, pending.id);
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.attemptCount, 2);
  assert.equal(messages.size, 1);
});

test("a permanent error fails the delivery and cannot be retried", async () => {
  providerBehavior.sendError = "PERMANENT";
  const [failed] = await deliverDisclosures("adv-001", "cl-104", ["fund-001"]);

  assert.equal(failed.status, "FAILED");
  assert.equal(failed.sentAt, null);
  assert.equal(messages.size, 0);
  assert.deepEqual(
    await getReceivedDisclosures("cmp-001", "cl-104", new Date()),
    [],
  );

  providerBehavior.sendError = null;
  await assert.rejects(
    retryDelivery("adv-001", failed.id),
    /cannot|Only pending/,
  );
  assert.equal(messages.size, 0);
});

for (const acceptedBeforeTimeout of [false, true]) {
  const scenario = acceptedBeforeTimeout
    ? "a timeout after acceptance recovers the original message without duplicates"
    : "a timeout before acceptance retries as a new send with the same key";

  test(scenario, async () => {
    providerBehavior.sendError = "TIMEOUT";
    providerBehavior.acceptOnTimeout = acceptedBeforeTimeout;
    const [unknown] = await deliverDisclosures("adv-001", "cl-105", [
      "fund-001",
    ]);
    const originalMessageId = [...messages.keys()][0];

    assert.equal(unknown.status, "UNKNOWN");
    assert.equal(unknown.providerMessageId, null);
    assert.equal(unknown.receivedAt, null);
    assert.equal(messages.size, acceptedBeforeTimeout ? 1 : 0);
    assert.deepEqual(
      await getReceivedDisclosures("cmp-001", "cl-105", new Date()),
      [],
    );

    providerBehavior.sendError = null;
    const [existing] = await deliverDisclosures("adv-001", "cl-105", [
      "fund-001",
    ]);
    assert.equal(existing.id, unknown.id);
    assert.equal(existing.attemptCount, 1);

    const recovered = await retryDelivery("adv-001", unknown.id);
    assert.equal(recovered.status, "ACCEPTED");
    assert.equal(recovered.id, unknown.id);
    assert.equal(messages.size, 1);
    assert.equal(
      messages.get(recovered.providerMessageId).idempotencyKey,
      unknown.id,
    );

    if (acceptedBeforeTimeout) {
      assert.equal(recovered.providerMessageId, originalMessageId);
    }
  });
}

test("retry errors do not erase uncertainty about an earlier timeout", async () => {
  providerBehavior.sendError = "TIMEOUT";
  const [unknown] = await deliverDisclosures("adv-001", "cl-105", ["fund-001"]);

  // A later failure says nothing about whether the timed-out attempt was accepted.
  for (const code of ["TRANSIENT", "PERMANENT"]) {
    providerBehavior.sendError = code;
    const retried = await retryDelivery("adv-001", unknown.id);

    assert.equal(retried.id, unknown.id);
    assert.equal(retried.status, "UNKNOWN");
    assert.equal(retried.receivedAt, null);

    const event = await prisma.deliveryEvent.findFirstOrThrow({
      where: { deliveryId: unknown.id },
      orderBy: { id: "desc" },
    });
    assert.equal(event.status, "UNKNOWN");
    assert.equal(event.detail, `Simulated ${code.toLowerCase()} error.`);
  }

  assert.equal(messages.size, 0);
});

test("an expired unknown outcome is not resent with a fresh idempotency window", async () => {
  providerBehavior.sendError = "TIMEOUT";
  providerBehavior.acceptOnTimeout = true;
  const [unknown] = await deliverDisclosures("adv-001", "cl-105", ["fund-001"]);
  const [message] = messages.values();

  message.acceptedAt = Date.now() - 25 * 60 * 60 * 1000;
  await prisma.delivery.update({
    where: { id: unknown.id },
    data: { firstAttemptAt: new Date(message.acceptedAt) },
  });
  providerBehavior.sendError = null;

  await assert.rejects(
    retryDelivery("adv-001", unknown.id),
    /24-hour retry window/,
  );
  const [existing] = await deliverDisclosures("adv-001", "cl-105", [
    "fund-001",
  ]);
  assert.equal(existing.id, unknown.id);
  assert.equal(existing.status, "UNKNOWN");
  assert.equal(existing.attemptCount, 1);
  assert.equal(messages.size, 1);
});

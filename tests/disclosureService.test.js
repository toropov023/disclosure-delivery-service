import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { seedSampleData } from "../prisma/seed-data.js";

// Set the test database before importing the shared client and services.
process.env.DATABASE_URL = ":memory:";
const { prisma } = await import("../src/utils/db.js");
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

  await seedSampleData(prisma);
});

after(() => prisma.$disconnect());

test("receipt history includes received versions by the cutoff, without duplicate events", async () => {
  const beforeReceipt = await getReceivedDisclosures(
    "cmp-001",
    "cl-101",
    "2026-02-10T14:21:59Z",
  );
  assert.deepEqual(beforeReceipt, []);

  const atReceipt = await getReceivedDisclosures(
    "cmp-001",
    "cl-101",
    "2026-02-10T14:22:00Z",
  );
  assert.deepEqual(
    atReceipt.map(({ documentId, documentVersion, fundId, receivedAt }) => ({
      documentId,
      documentVersion,
      fundId,
      receivedAt,
    })),
    [
      {
        documentId: "doc-001",
        documentVersion: 2,
        fundId: "fund-001",
        receivedAt: new Date("2026-02-10T14:22:00Z"),
      },
    ],
  );

  const original = await prisma.deliveryEvent.findFirstOrThrow({
    where: { clientId: "cl-101", documentId: "doc-001" },
  });
  assert.deepEqual(atReceipt, [original]);
  const copy = { ...original };
  delete copy.id;

  await prisma.deliveryEvent.createMany({
    data: [
      copy,
      {
        ...copy,
        deliveryId: "new-version-delivery",
        documentVersion: 3,
        receivedAt: new Date("2026-09-30T12:00:00Z"),
      },
    ],
  });

  const historical = await getReceivedDisclosures(
    "cmp-001",
    "cl-101",
    "2026-03-06T00:00:00Z",
  );
  assert.deepEqual(
    historical.map(({ documentId, documentVersion }) => [
      documentId,
      documentVersion,
    ]),
    [
      ["doc-001", 2],
      ["doc-002", 1],
    ],
  );

  const later = await getReceivedDisclosures(
    "cmp-001",
    "cl-101",
    "2026-09-30T12:00:00Z",
  );
  assert.deepEqual(
    later.map(({ documentId, documentVersion }) => [
      documentId,
      documentVersion,
    ]),
    [
      ["doc-001", 2],
      ["doc-001", 3],
      ["doc-002", 1],
    ],
  );

  const bounced = await getReceivedDisclosures(
    "cmp-001",
    "cl-102",
    "2026-09-30T12:00:00Z",
  );
  assert.deepEqual(bounced, []);
});

test("receipt history allows compliance and the client's advisor", async () => {
  const complianceHistory = await getReceivedDisclosures(
    "cmp-001",
    "cl-101",
    "2026-03-06T00:00:00Z",
  );
  const advisorHistory = await getReceivedDisclosures(
    "adv-001",
    "cl-101",
    "2026-03-06T00:00:00Z",
  );
  assert.deepEqual(advisorHistory, complianceHistory);

  await assert.rejects(
    getReceivedDisclosures("adv-002", "cl-101", "2026-03-06T00:00:00Z"),
    /their own clients/,
  );
});

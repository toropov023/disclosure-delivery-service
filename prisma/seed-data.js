import sampleData from "../docs/Send to Candidate_sample-data.json" with { type: "json" };

const legacyAdvisor = {
  id: "user-legacy",
  name: "Legacy (unknown)",
  role: "ADVISOR",
};

/** Import missing sample records atomically, preserving existing data on reruns. */
export async function seedSampleData(prisma, data = sampleData) {
  await prisma.$transaction(async (tx) => {
    const users = [
      ...data.advisors.map((advisor) => ({
        id: advisor.advisor_id,
        name: advisor.name,
        role: "ADVISOR",
      })),
      ...data.compliance_users.map((user) => ({
        id: user.user_id,
        name: user.name,
        role: "COMPLIANCE",
      })),
      legacyAdvisor,
    ];

    for (const user of users) {
      await tx.user.upsert({
        where: { id: user.id },
        update: {},
        create: user,
      });
    }

    for (const client of data.clients) {
      await tx.client.upsert({
        where: { id: client.client_id },
        update: {},
        create: {
          id: client.client_id,
          advisorId: client.advisor_id,
          name: client.name,
          email: client.email,
        },
      });
    }

    for (const fund of data.funds) {
      await tx.fund.upsert({
        where: { id: fund.fund_id },
        update: {},
        create: { id: fund.fund_id, name: fund.name },
      });
    }

    for (const document of data.documents) {
      for (const version of document.versions) {
        await tx.disclosureDocument.upsert({
          where: {
            id_version: {
              id: document.document_id,
              version: version.version,
            },
          },
          update: {},
          create: {
            id: document.document_id,
            fundId: document.fund_id,
            version: version.version,
            publishedAt: new Date(version.published_at),
          },
        });
      }
    }

    for (const history of data.delivery_history) {
      // Stable IDs identify imported messages; they are never sent to the provider.
      const id = `legacy:${history.provider_message_id}`;
      const existingDelivery = await tx.delivery.findUnique({ where: { id } });
      const existingEvent = await tx.deliveryEvent.findFirst({
        where: { deliveryId: id },
      });

      // An audit event also proves import if the operational row was later deleted.
      if (existingDelivery || existingEvent) {
        continue;
      }

      const document = await tx.disclosureDocument.findUniqueOrThrow({
        where: {
          id_version: {
            id: history.document_id,
            version: history.version,
          },
        },
      });
      const status = history.status.toUpperCase();
      const sentAt = new Date(history.sent_at);
      const receivedAt = status === "DELIVERED" ? sentAt : null;

      await tx.delivery.create({
        data: {
          id,
          // The source has no request grouping, so each imported message gets its own.
          requestId: id,
          clientId: history.client_id,
          disclosureDocumentId: history.document_id,
          disclosureDocumentVersion: history.version,
          providerMessageId: history.provider_message_id,
          status,
          sentAt,
          receivedAt,
        },
      });

      await tx.deliveryEvent.create({
        data: {
          deliveryId: id,
          status,
          detail:
            "Imported sample history. Historical advisor, names and recipient email are unknown. " +
            (receivedAt
              ? "Receipt time is assumed to equal sent_at because no receipt timestamp was supplied."
              : "The message bounced; no receipt is recorded."),
          advisorId: legacyAdvisor.id,
          advisorName: legacyAdvisor.name,
          clientId: history.client_id,
          clientName: "Legacy (unknown)",
          recipientEmail: "legacy@unknown.invalid",
          fundId: document.fundId,
          fundName: "Legacy (unknown)",
          documentId: history.document_id,
          documentVersion: history.version,
          providerMessageId: history.provider_message_id,
          sentAt,
          receivedAt,
        },
      });
    }
  });
}

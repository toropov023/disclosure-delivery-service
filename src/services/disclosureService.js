import { prisma } from "../utils/db.js";

/**
 * Find the highest published version for each requested fund
 * @param {string[]} fundIds - Funds to look up
 * @returns {Promise<DisclosureDocument[]>} One current document version per fund
 */
export async function getCurrentDisclosures(fundIds) {
  if (
    !Array.isArray(fundIds) ||
    !fundIds.length ||
    fundIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new Error("Provide at least one fund ID.");
  }

  const documents = await prisma.disclosureDocument.findMany({
    where: { fundId: { in: fundIds }, publishedAt: { lte: new Date() } },
    orderBy: [{ fundId: "asc" }, { version: "desc" }],
    distinct: ["fundId"], // allows selecting one version per fund
  });

  for (const fundId of fundIds) {
    if (!documents.some((document) => document.fundId === fundId)) {
      throw new Error(`No published disclosure found for fund ${fundId}.`);
    }
  }

  return documents;
}

/**
 * List the document versions a client had received by asOf
 * @param {string} userId - A compliance user or the client's current advisor
 * @param {string} clientId - Client whose receipt history is requested
 * @param {Date|string} asOf - Date or ISO timestamp to include receipts through
 * @returns {Promise<DeliveryEvent[]>} Distinct document versions with their earliest receipt times
 */
export async function getReceivedDisclosures(userId, clientId, asOf) {
  if (!userId || !clientId) {
    throw new Error("User ID and client ID are required.");
  }

  const cutoff = new Date(asOf);

  if (asOf == null || Number.isNaN(cutoff.getTime())) {
    throw new Error("A valid as-of date is required.");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (user?.role === "ADVISOR") {
    const client = await prisma.client.findUnique({ where: { id: clientId } });

    if (client?.advisorId !== user.id) {
      throw new Error(
        "Advisors can only query receipt history for their own clients.",
      );
    }
  } else if (user?.role !== "COMPLIANCE") {
    throw new Error(
      "An advisor or compliance user is required to query receipt history.",
    );
  }

  // Repeated events for one version return its earliest recorded receipt time
  return prisma.deliveryEvent.findMany({
    where: {
      clientId,
      status: "DELIVERED",
      receivedAt: { lte: cutoff },
    },
    orderBy: [
      { documentId: "asc" },
      { documentVersion: "asc" },
      { receivedAt: "asc" },
    ],
    distinct: ["documentId", "documentVersion"],
  });
}

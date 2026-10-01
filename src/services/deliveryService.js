import { randomUUID } from "node:crypto";
import { prisma } from "../utils/db.js";
import { httpError } from "../utils/httpError.js";
import * as notificationProvider from "../utils/notificationProvider.js";
import { getCurrentDisclosures } from "./disclosureService.js";

/**
 * Send needed disclosures, reusing deliveries already in progress
 * Assumes calls for the same client run sequentially in this demo
 * @param {string} advisorId - Advisor making the request
 * @param {string} clientId - One of the advisor's clients
 * @param {string[]} fundIds - Funds whose current disclosures are needed
 * @returns {Promise<Delivery[]>} New or active deliveries; received versions are omitted
 */
export async function deliverDisclosures(advisorId, clientId, fundIds) {
  if (!advisorId || !clientId) {
    throw httpError(400, "Advisor ID and client ID are required.");
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, advisorId, advisor: { role: "ADVISOR" } },
    include: { advisor: true },
  });

  if (!client) {
    throw httpError(
      403,
      "Advisors can only send disclosures to their own clients.",
    );
  }

  const documents = await getCurrentDisclosures(fundIds);
  const requestId = randomUUID();
  const deliveries = [];

  for (const document of documents) {
    const receipt = await prisma.deliveryEvent.findFirst({
      where: {
        clientId,
        documentId: document.id,
        documentVersion: document.version,
        status: "DELIVERED",
      },
    });

    // if already received, skip sending it
    if (receipt) {
      continue;
    }

    const active = await prisma.delivery.findFirst({
      where: {
        clientId,
        disclosureDocumentId: document.id,
        disclosureDocumentVersion: document.version,
        status: { in: ["PENDING", "UNKNOWN", "ACCEPTED"] },
      },
    });

    // Refresh an active delivery before deciding whether another send is needed
    if (active) {
      const refreshed = await getDeliveryStatus(advisorId, active.id);

      if (refreshed.status === "DELIVERED") {
        continue;
      }

      if (refreshed.status !== "BOUNCED") {
        deliveries.push(refreshed);
        continue;
      }
    }

    const fund = await prisma.fund.findUniqueOrThrow({
      where: { id: document.fundId },
    });
    const snapshot = {
      advisorId,
      advisorName: client.advisor.name,
      clientId,
      clientName: client.name,
      recipientEmail: client.email,
      fundId: fund.id,
      fundName: fund.name,
      documentId: document.id,
      documentVersion: document.version,
    };
    const delivery = await saveDelivery(
      null,
      {
        requestId,
        clientId,
        disclosureDocumentId: document.id,
        disclosureDocumentVersion: document.version,
      },
      snapshot,
      "Delivery requested.",
    );

    deliveries.push(await sendDelivery(delivery));
  }

  return deliveries;
}

/**
 * Check an accepted message with the provider and record any status change
 * @param {string} advisorId - The client's current advisor
 * @param {string} deliveryId - Delivery to check
 * @returns {Promise<Delivery>} Current delivery state
 */
export async function getDeliveryStatus(advisorId, deliveryId) {
  const delivery = await getOwnedDelivery(advisorId, deliveryId);

  // Only accepted deliveries need a provider status check
  if (delivery.status !== "ACCEPTED") {
    return delivery;
  }

  const status = (
    await notificationProvider.getStatus(delivery.providerMessageId)
  ).toUpperCase();

  // If the provider reports the same outcome, no update is needed
  if (status === delivery.status) {
    return delivery;
  }

  const snapshot = await prisma.deliveryEvent.findFirstOrThrow({
    where: { deliveryId },
    orderBy: { id: "asc" },
  });

  // record the status update
  return saveDelivery(
    deliveryId,
    { status, receivedAt: status === "DELIVERED" ? new Date() : null },
    snapshot,
    `Provider reports ${status.toLowerCase()}.`,
  );
}

/**
 * Retry an unsent or uncertain delivery using the same provider key
 * @param {string} advisorId - The client's current advisor
 * @param {string} deliveryId - Pending or unknown delivery to retry
 * @returns {Promise<Delivery>} Result of this attempt
 */
export async function retryDelivery(advisorId, deliveryId) {
  const delivery = await getOwnedDelivery(advisorId, deliveryId);

  if (!["PENDING", "UNKNOWN"].includes(delivery.status)) {
    throw httpError(409, "Only pending or unknown deliveries can be retried.");
  }

  return sendDelivery(delivery);
}

/**
 * Load a delivery only when its client belongs to this advisor
 * @param {string} advisorId
 * @param {string} deliveryId
 * @returns {Promise<Delivery>}
 */
async function getOwnedDelivery(advisorId, deliveryId) {
  if (!advisorId || !deliveryId) {
    throw httpError(400, "Advisor ID and delivery ID are required.");
  }

  const delivery = await prisma.delivery.findFirst({
    where: {
      id: deliveryId,
      client: { advisorId, advisor: { role: "ADVISOR" } },
    },
  });

  if (!delivery) {
    throw httpError(
      404,
      "Delivery not found or not accessible to this advisor.",
    );
  }

  return delivery;
}

/**
 * Make one attempt, keeping the original recipient and document on retries
 * @param {Delivery} delivery
 * @returns {Promise<Delivery>}
 */
async function sendDelivery(delivery) {
  if (
    delivery.status === "UNKNOWN" &&
    (!delivery.firstAttemptAt ||
      Date.now() - delivery.firstAttemptAt.getTime() >=
        notificationProvider.IDEMPOTENCY_WINDOW_MS)
  ) {
    throw httpError(
      409,
      "Delivery outcome is unknown and the 24-hour retry window has expired. Manual review is required.",
    );
  }

  const snapshot = await prisma.deliveryEvent.findFirstOrThrow({
    where: { deliveryId: delivery.id },
    orderBy: { id: "asc" },
  });

  // A crash during send must leave an uncertain outcome, never a safe-to-resend state
  await saveDelivery(
    delivery.id,
    {
      status: "UNKNOWN",
      firstAttemptAt: delivery.firstAttemptAt ?? new Date(),
      attemptCount: { increment: 1 },
    },
    snapshot,
    "Sending to provider; outcome not yet confirmed.",
  );

  let providerMessageId;

  try {
    providerMessageId = await notificationProvider.send(
      snapshot.recipientEmail,
      snapshot.documentId,
      snapshot.documentVersion,
      delivery.id,
    );
  } catch (error) {
    let status = "UNKNOWN";

    // Failure of a later attempt cannot erase uncertainty about an earlier one
    if (delivery.status !== "UNKNOWN") {
      if (error.code === "TRANSIENT") status = "PENDING";
      if (error.code === "PERMANENT") status = "FAILED";
    }

    return saveDelivery(delivery.id, { status }, snapshot, error.message);
  }

  return saveDelivery(
    delivery.id,
    { status: "ACCEPTED", providerMessageId, sentAt: new Date() },
    snapshot,
    "Provider accepted the message.",
  );
}

/**
 * Save delivery state and its audit snapshot together
 * @param {string|null} deliveryId - Null creates a delivery
 * @param {object} data - Delivery fields to create or update
 * @param {object} snapshot - Original advisor, client, fund, and document details
 * @param {string} detail - What happened
 * @returns {Promise<Delivery>}
 */
async function saveDelivery(deliveryId, data, snapshot, detail) {
  // use a transaction to ensure the delivery and its event are saved together
  return prisma.$transaction(async (tx) => {
    const delivery = deliveryId
      ? await tx.delivery.update({ where: { id: deliveryId }, data })
      : await tx.delivery.create({ data });

    await tx.deliveryEvent.create({
      data: {
        deliveryId: delivery.id,
        status: delivery.status,
        detail,
        advisorId: snapshot.advisorId,
        advisorName: snapshot.advisorName,
        clientId: snapshot.clientId,
        clientName: snapshot.clientName,
        recipientEmail: snapshot.recipientEmail,
        fundId: snapshot.fundId,
        fundName: snapshot.fundName,
        documentId: snapshot.documentId,
        documentVersion: snapshot.documentVersion,
        providerMessageId: delivery.providerMessageId,
        sentAt: delivery.sentAt,
        receivedAt: delivery.receivedAt,
      },
    });

    return delivery;
  });
}

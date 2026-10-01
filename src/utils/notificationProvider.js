import { randomUUID } from "node:crypto";

// Fake provider: no real emails. These settings apply until changed or reset.
export const providerBehavior = {
  /** @type {null | "TRANSIENT" | "PERMANENT" | "TIMEOUT"} */
  sendError: null,
  acceptOnTimeout: false, // whether acceptance happened before the response was lost
  /** @type {"accepted" | "delivered" | "bounced"} */
  status: "accepted",
};

// Accepted messages, keyed by ID. Tests can change a message's status or acceptedAt.
export const messages = new Map();

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Accept a document for delivery and return its message ID. Errors have a code. */
export async function send(
  recipientEmail,
  documentId,
  version,
  idempotencyKey,
) {
  const now = Date.now();
  let previous;

  // find the most recent message with the same idempotency key, if any
  for (const message of messages.values()) {
    if (
      message.idempotencyKey === idempotencyKey &&
      (!previous || message.acceptedAt > previous.acceptedAt)
    ) {
      previous = message;
    }
  }

  if (previous) {
    // if the previous message is for a different recipient or document, reject it
    if (
      previous.recipientEmail !== recipientEmail ||
      previous.documentId !== documentId ||
      previous.version !== version
    ) {
      throw providerError("PERMANENT", "This key belongs to another message.");
    }

    if (now - previous.acceptedAt < IDEMPOTENCY_WINDOW_MS) {
      return previous.id;
    }
  }

  const { sendError, acceptOnTimeout } = providerBehavior;
  let messageId;

  // A timeout can happen after acceptance, before the caller receives the ID
  if (!sendError || (sendError === "TIMEOUT" && acceptOnTimeout)) {
    messageId = randomUUID();
    messages.set(messageId, {
      id: messageId,
      recipientEmail,
      documentId,
      version,
      idempotencyKey,
      acceptedAt: now,
      status: null,
    });
  }

  if (sendError) {
    throw providerError(
      sendError,
      `Simulated ${sendError.toLowerCase()} error.`,
    );
  }

  return messageId;
}

/** Return the message's test status, or the configured default (also for imported IDs). */
export async function getStatus(messageId) {
  return messages.get(messageId)?.status ?? providerBehavior.status;
}

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

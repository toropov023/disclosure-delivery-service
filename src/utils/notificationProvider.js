import { randomUUID } from "node:crypto";

// Fake provider: no real emails. These settings apply until changed or reset.
export const providerBehavior = {
  /** @type {null | "TRANSIENT" | "PERMANENT" | "TIMEOUT"} */
  sendError: null,
  acceptOnTimeout: false, // whether acceptance happened before the response was lost
  /** @type {null | "accepted" | "delivered" | "bounced"} */
  status: null, // Null uses the document outcomes below; tests can override it.
};

// Deterministic demo outcomes, observed only when querying an accepted message.
const demoStatuses = {
  "doc-001": "delivered",
  "doc-002": "bounced",
  "doc-003": "delivered",
};

// Remember the one simulated failure per intended doc-003 message until restart.
export const transientFailures = new Set();

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

  if (
    !sendError &&
    documentId === "doc-003" &&
    !previous &&
    !transientFailures.has(idempotencyKey)
  ) {
    transientFailures.add(idempotencyKey);
    throw providerError(
      "TRANSIENT",
      "Simulated first-attempt failure for doc-003.",
    );
  }

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

/** Return a test override or demo outcome; unknown/imported IDs remain accepted. */
export async function getStatus(messageId) {
  const message = messages.get(messageId);

  return (
    message?.status ??
    providerBehavior.status ??
    demoStatuses[message?.documentId] ??
    "accepted"
  );
}

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  messages,
  providerBehavior,
  send,
  transientFailures,
} from "../src/utils/notificationProvider.js";

/** Start each test with an empty provider and normal responses. */
function reset() {
  messages.clear();
  transientFailures.clear();
  providerBehavior.sendError = null;
  providerBehavior.acceptOnTimeout = false;
  providerBehavior.status = "accepted";
}

beforeEach(reset);

test("doc-003 fails once per key, then accepts and deduplicates retries", async () => {
  for (const key of ["retry-1", "retry-2"]) {
    const size = messages.size;
    await assert.rejects(send("client@example.com", "doc-003", 2, key), {
      code: "TRANSIENT",
    });
    assert.equal(messages.size, size);

    const id = await send("client@example.com", "doc-003", 2, key);
    assert.equal(await send("client@example.com", "doc-003", 2, key), id);
    assert.equal(messages.size, size + 1);
  }
});

test("a key older than 24 hours results in a new message", async () => {
  const id = await send("client@example.com", "doc-1", 1, "delivery-1");
  messages.get(id).acceptedAt = Date.now() - 25 * 60 * 60 * 1000;

  const newId = await send("client@example.com", "doc-1", 1, "delivery-1");
  const repeatedId = await send("client@example.com", "doc-1", 1, "delivery-1");

  assert.notEqual(newId, id);
  assert.equal(repeatedId, newId);
  assert.equal(messages.size, 2);
});

test("a key cannot identify a different message, even after expiry", async () => {
  const id = await send("client@example.com", "doc-1", 1, "delivery-1");

  for (const ageInHours of [0, 25]) {
    messages.get(id).acceptedAt = Date.now() - ageInHours * 60 * 60 * 1000;

    await assert.rejects(send("client@example.com", "doc-1", 2, "delivery-1"), {
      code: "PERMANENT",
    });
  }

  assert.equal(messages.size, 1);
});

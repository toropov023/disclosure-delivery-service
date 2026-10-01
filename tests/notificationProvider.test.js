import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  messages,
  providerBehavior,
  send,
} from "../src/utils/notificationProvider.js";

/** Start each test with an empty provider and normal responses. */
function reset() {
  messages.clear();
  providerBehavior.sendError = null;
  providerBehavior.acceptOnTimeout = false;
  providerBehavior.status = "accepted";
}

beforeEach(reset);

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

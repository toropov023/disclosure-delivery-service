import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  getStatus,
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

test("accepts a message and reuses its ID for the same key", async () => {
  const id = await send("client@example.com", "doc-1", 1, "delivery-1");
  const repeatedId = await send("client@example.com", "doc-1", 1, "delivery-1");

  assert.equal(repeatedId, id);
  assert.equal(messages.size, 1);
  assert.equal(await getStatus(id), "accepted");
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

for (const code of ["TRANSIENT", "PERMANENT"]) {
  test(`${code} errors do not accept a message`, async () => {
    providerBehavior.sendError = code;

    await assert.rejects(send("client@example.com", "doc-1", 1, "delivery-1"), {
      code,
    });
    assert.equal(messages.size, 0);

    if (code === "TRANSIENT") {
      providerBehavior.sendError = null;
      await send("client@example.com", "doc-1", 1, "delivery-1");
      assert.equal(messages.size, 1);
    }
  });
}

test("a timeout before acceptance leaves the key available for a retry", async () => {
  providerBehavior.sendError = "TIMEOUT";

  await assert.rejects(send("client@example.com", "doc-1", 1, "delivery-1"), {
    code: "TIMEOUT",
  });
  assert.equal(messages.size, 0);

  providerBehavior.sendError = null;
  await send("client@example.com", "doc-1", 1, "delivery-1");
  assert.equal(messages.size, 1);
});

test("a timeout after acceptance can be retried without a duplicate", async () => {
  providerBehavior.sendError = "TIMEOUT";
  providerBehavior.acceptOnTimeout = true;

  await assert.rejects(send("client@example.com", "doc-1", 1, "delivery-1"), {
    code: "TIMEOUT",
  });
  const [acceptedId] = messages.keys();
  assert.equal(messages.size, 1);

  providerBehavior.sendError = null;
  const id = await send("client@example.com", "doc-1", 1, "delivery-1");
  assert.equal(id, acceptedId);
  assert.equal(messages.size, 1);
});

test("statuses can change globally or for one message", async () => {
  const id = await send("client@example.com", "doc-1", 1, "delivery-1");

  providerBehavior.status = "delivered";
  assert.equal(await getStatus(id), "delivered");

  messages.get(id).status = "bounced";
  assert.equal(await getStatus(id), "bounced");
  assert.equal(await getStatus("imported-message"), "delivered");
});

# Disclosure Delivery Service: Take-Home Exercise

Thank you for taking the time to work on this exercise. It's designed to reflect the kind of work our team does day to day. We're interested in how you reason about a problem, not in how much code you can produce, so please read the time guidance below before you start.

## Background

For this exercise, assume that before recommending an investment, a financial advisor must provide the client with that fund's disclosure document. Each fund has one disclosure document, which is periodically republished as a new version. (This is a simplified version of real-world requirements; you don't need any financial services background to complete the exercise.)

Compliance teams must be able to verify, after the fact, exactly which version of each document a client received and when. Correctness and auditability matter more here than anything else.

## Scale

Roughly 2,000 advisors, each with a few hundred clients. A typical advisor initiates a handful of deliveries per day. Please optimize for correctness and auditability, not throughput or concurrency.

## What to build

A small backend service, in any mainstream language, that supports the following.

**Required**

1. **Deliver disclosures.** An advisor requests delivery of disclosure documents to one of their clients for one or more funds. The service determines which documents actually need to be sent, sends them through the notification provider, and records the outcome.
2. **Check delivery status.** An advisor can see the status of the deliveries they've requested.
3. **Answer the compliance question.** A compliance user can ask: *"Which disclosure documents, and which versions, had client X received as of time T?"*

**Optional**

4. **HTTP API.** You may build a thin HTTP layer over your service, or you may instead describe the API you would expose (endpoints, requests, responses) in your design document. Either is fine. We'd rather you spend your time on the core logic.

## Rules

- A client needs a document only if they have not already received its current version.
- Advisors can act only on their own clients.
- All deliveries go through the notification provider described below.

Where requirements are unclear, make a reasonable assumption and document it. Identifying and resolving ambiguity is part of the exercise.

## Notification provider contract

You won't call a real provider. Instead, define this contract as an interface in your language and write a fake implementation for your tests. **Your tests should show how your service handles each outcome described below.**

**`send(recipient_email, document_id, version, idempotency_key) → message_id`**

- On success, the message is accepted for delivery and a `message_id` is returned.
- **Idempotency:** if a message has already been accepted with the same `idempotency_key` within the last 24 hours, `send` returns that original `message_id` and does not send a second message. If no message was accepted with that key (for example, the earlier call failed), the call is processed as a new send.
- Each `idempotency_key` should be used for only one intended message.

**Possible errors from `send`:**

- **Transient error:** the message was not sent. It is safe to retry.
- **Permanent error** (for example, an invalid recipient): the message was not sent. Retrying will not help.
- **Timeout:** the outcome is unknown. The message may or may not have been accepted.

**`get_status(message_id) → accepted | delivered | bounced`**

- A message's status may change after `send` returns. For example, a message that was accepted may later bounce.
- For this exercise, assume `get_status` always succeeds.

## Sample data

`sample-data.json` contains advisors, compliance users, clients, funds, disclosure documents with their version history, and a record of past deliveries made before your service existed. Your service should take this history into account. You may load the data however you like.

## Simplifications you may make

- **Storage:** in-memory storage is fine, ideally behind an interface. In your design document, explain how your approach would work with durable storage, including what happens if the process crashes partway through a delivery.
- **Identity:** no real authentication is needed. It's fine for callers to pass an advisor or compliance user ID directly.
- **Documents:** you don't need to render or store document files. Referring to a document by its ID and version is enough.
- **No UI** is needed.

## Deliverables

1. **Design document** (1–2 pages): your data model, key decisions and trade-offs, the assumptions you made, and known limitations.
2. **Working code with tests.**
3. **README:** how to run the code and the tests using standard tooling for your language, plus what you would do with more time.
4. **AI usage notes:** you are welcome to use AI tools. Please tell us which tools you used and for what, what you accepted, changed, or rejected, and how you verified the output.

## Time

Please plan for **3–4 hours** in total, and don't spend more than that. As a rough guide:

| Part | Time |
|---|---|
| Reading the prompt and writing the design document | 30–45 minutes |
| Core logic, fake provider, and tests | about 2 hours |
| README, assumptions, and AI usage notes | about 30 minutes |

A well-reasoned partial solution is better than a rushed complete one. If you run out of time, note in your README what you would have done next.

## Submitting and questions

- **How to submit:** A link to a Git repository, or email us a zip file.
- **Questions:** Please reach out to your HR contact. We'll respond as soon as we can.
- **Make it private later:** Please don't share this exercise. And, once the interview process is complete, please make the repositoty private. We use the exercise with other candidates.

## What happens next

After you submit, we'll have two follow-up conversations: one reviewing your submission with you, and one discussing how you would operate and support this service in production.

Both conversations take place over video, with a shared document and chat open throughout. You're welcome to answer by speaking, typing, or a mix of both, whichever suits you. If anything else would help you do your best work, let us know.

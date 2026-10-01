# Design

The service sends missing fund disclosures, tracks delivery outcomes, and answers which versions a client had received at a given time. JavaScript and Express handle the API; Prisma and SQLite provide storage without a separate database server.

## Data model

See `prisma/schema.prisma`.

- `User` and `Client`: users are advisors or compliance users. Each client belongs to one advisor.
- `Fund` and `DisclosureDocument`: one logical document per fund, with a row for each version. Document ID and version form the primary key. Current means the highest version published by now.
- `Delivery`: the current state of one intended message. Its ID is the provider idempotency key. `requestId` groups new deliveries from one request.
- `DeliveryEvent`: audit events with copies of the original client, advisor, recipient, fund, and document details. No foreign keys to live records, so later edits do not change history.

## Sending and status

The service checks client ownership, finds the current documents, and skips versions already received, including legacy receipts. It returns existing `PENDING`, `UNKNOWN`, or `ACCEPTED` deliveries without sending again or checking the provider. Remaining documents are sent independently; a later failure does not undo earlier sends.

- `PENDING`: not attempted yet, or a transient error confirmed it was not sent.
- `UNKNOWN`: a send is in progress, or acceptance is uncertain after a timeout.
- `ACCEPTED`: the provider accepted the message and returned an ID. This is not a receipt.
- `DELIVERED`: the provider confirmed delivery.
- `BOUNCED`: the accepted message could not be delivered.
- `FAILED`: a permanent send error. Retrying that delivery will not help.

Only the status endpoint checks accepted messages with the provider. Delivered and bounced outcomes are final for that message. A new send request can replace a bounced or failed delivery because the document is still needed.

## Retries and crashes

Retries are explicit and allowed only for pending or unknown deliveries. They keep the original recipient, document version, and key. Within 24 hours of acceptance, the provider returns the original message ID for that key instead of sending twice.

Each state change and audit event is saved in one transaction. The provider call happens separately. Saving `UNKNOWN` before calling it leaves a recoverable state if the process crashes during sending or before saving the response.

A later retry error does not resolve an earlier timeout. Unknown deliveries stay unknown, and retries are blocked after 24 hours from the first attempt, or if that time is missing. This cutoff is conservative because acceptance may have happened later. Expired uncertainty needs manual investigation; no review workflow is implemented.

## Compliance history

The query returns one receipt per document/version with `receivedAt <= asOf`, using the earliest receipt. Older versions remain visible. Accepted, pending, failed, and bounced messages do not count.

The provider gives no delivery timestamp, so new receipt times mean when delivery was first observed. Imported delivered records use `sent_at` as the assumed receipt time. Missing historical identity details use legacy placeholders.

## API and demo

Use `http://localhost:3000`, JSON bodies, and `X-User-Id: adv-001` for delivery requests. Use `cmp-001` for compliance. The header is a demo identity, not authentication. Access follows the client's current advisor; compliance can query any client, and advisors can query their own clients' receipts.

1. `POST /deliveries` with the body below. On a fresh `cl-105`, funds 001 and 002 return `ACCEPTED`; fund 003 fails once with `PENDING`.
2. `GET /deliveries/:id`. Copy each delivery ID manually. Fund 001 becomes `DELIVERED`, fund 002 becomes `BOUNCED`, and fund 003 stays `PENDING`.
3. `POST /deliveries/:id/retry` for fund 003, with no body. It becomes `ACCEPTED`; another status check confirms `DELIVERED`.
4. `GET /clients/cl-105/disclosures?asOf=2026-10-01T23:59:59-06:00` returns receipts for documents 001 and 003. Update the cutoff for later demos. For legacy receipts, query `cl-101`.

```json
{
  "clientId": "cl-105",
  "fundIds": ["fund-001", "fund-002", "fund-003"]
}
```

Existing receipts are skipped, so repeating the demo may return fewer deliveries. Send returns an array; status and retry return one record. Successful requests return 200 even when a provider attempt fails. Invalid requests return JSON errors; disallowed retries return 409.

## Tests and limits

The 20 tests cover version selection, ownership, legacy imports, all provider outcomes, idempotency, retries, audit preservation, and receipt cutoffs. Database tests use isolated in-memory SQLite; API tests start a temporary server. For the walkthrough, show the timeout-after-acceptance test in `tests/deliveryService.test.js` and the cutoff test in `tests/disclosureService.test.js`.

Calls for the same client must run sequentially; concurrent sends could duplicate messages. There is no background polling or retry worker. Audit events are append-only through the service, but direct database edits are not prevented.

The fake provider sends no email and loses messages and fail-once tracking on restart. SQLite persists, but recovery against a durable provider and actual process crashes is not tested.

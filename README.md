# Disclosure Delivery Service

A service for delivering fund disclosure documents and tracking delivery history, built with JavaScript, Express, Prisma, and SQLite.

## Requirements

Install [Node.js 24 LTS](https://nodejs.org/en/download). It includes npm.

## Run

Download or clone this repository and open a terminal in its folder. Run:

```sh
npm ci
npm run db:setup
npm start
```

Health check: [http://localhost:3000/health](http://localhost:3000/health).

Press **Ctrl+C** to stop. During development, use `npm run dev` instead of `npm start` to restart automatically when JavaScript files change.

## Database

SQLite stores data in a local file and needs no separate installation. Prisma is configured to use `prisma/dev.db`.

`npm run db:setup` generates the Prisma client, applies migrations, and imports the supplied sample data. To rerun just the import, use `npm run db:seed`. Existing records and audit events are left unchanged.

Historical deliveries keep their original client, document, and provider IDs and send times. Unknown historical advisor, name, and email values use legacy placeholders. For delivered history, receipt time is assumed to equal the supplied `sent_at`; bounced messages have no receipt time.

After adding or changing models in `prisma/schema.prisma`, create a migration and generate the client:

```sh
npx prisma migrate dev --name describe_change
npx prisma generate
```

The client is generated at `generated/prisma/client.ts` and runs directly on Node.js 24. Application code uses JavaScript.

Validate the schema or browse the database:

```sh
npx prisma validate
npx prisma studio
```

## Checks

```sh
npm run lint
npm run lint:fix
npm test
```

`npm run lint` checks JavaScript and formatting. `npm run lint:fix` applies automatic fixes and formats files with semicolons and double quotes.

`npm test` runs service, provider, API, and import tests. Database tests use in-memory SQLite; API tests start a temporary local server.

## Project files

- `src/server.js` - starts the HTTP server.
- `src/app.js` - Express setup, routes, health endpoint, and error responses.
- `src/utils/db.js` - shared Prisma client.
- `prisma/schema.prisma` - database model.
- `prisma.config.js` - Prisma configuration and SQLite file location.
- `prisma/migrations/` - database migrations.
- `prisma/seed.js` - sample-data import entry point.

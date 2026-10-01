# Disclosure Delivery Service

A small JavaScript API for sending fund disclosure documents and tracking what clients received. Built with Express, Prisma, and SQLite.

## Run

Requires Node.js 24 and npm.

```sh
npm ci
npm run db:setup
npm start
```

The server runs at `http://localhost:3000`. Check `GET /health` to confirm it is running. Use `npm run dev` for automatic restarts during development.

SQLite uses `prisma/dev.db` by default. Setup generates the Prisma client, applies migrations, and imports the supplied sample data. `npm run db:seed` reruns the import without resetting existing records.

## Project structure

- `prisma/`: schema, migrations, and sample-data import.
- `src/routes/` and `src/controllers/`: HTTP endpoints and request handling.
- `src/services/`: delivery rules and compliance queries.
- `src/utils/`: Prisma client, fake notification provider, and error helper.
- `tests/`: service, provider, API, and import tests.

[DESIGN.md](DESIGN.md) covers the model, status flow, assumptions, and Postman walkthrough. [AI_USAGE.md](AI_USAGE.md) describes how AI was used.

## Checks

```sh
npm test
npm run lint
```

Tests do not change the demo database. `npm run lint:fix` applies formatting and automatic lint fixes.

## With more time

Add real authentication, prevent concurrent duplicate sends, and use a durable provider with background status checks and recovery for uncertain deliveries.

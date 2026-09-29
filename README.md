# Disclosure Delivery Service

A service for delivering fund disclosure documents and tracking delivery history, built with JavaScript, Express, Prisma, and SQLite.

## Requirements

Install [Node.js 24 LTS](https://nodejs.org/en/download). It includes npm.

## Run

Download or clone this repository and open a terminal in its folder. Run:

```sh
npm ci
npm start
```

Health check: [http://localhost:3000/health](http://localhost:3000/health).

Press **Ctrl+C** to stop. During development, use `npm run dev` instead of `npm start` to restart automatically when JavaScript files change.

## Database

SQLite stores data in a local file and needs no separate installation. Prisma is configured to use `prisma/dev.db`.

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

## Lint and format

```sh
npm run lint
npm run lint:fix
```

`npm run lint` checks JavaScript and formatting. `npm run lint:fix` applies automatic fixes and formats files with semicolons and double quotes.

## Project files

- `src/server.js` - Express server and health endpoint.
- `prisma/schema.prisma` - database model.
- `prisma.config.js` - Prisma configuration and SQLite file location.

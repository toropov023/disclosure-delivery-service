import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.ts";

// Share one client across the application. The CLI uses the same URL in prisma.config.js.
export const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url:
      process.env.DATABASE_URL ||
      `file:${fileURLToPath(new URL("../prisma/dev.db", import.meta.url))}`,
  }),
});

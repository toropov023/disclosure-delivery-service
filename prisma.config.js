import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// Work around SQLite migration failures on macOS: https://github.com/prisma/prisma/issues/29355
process.env.RUST_LOG ??= "info";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "node prisma/seed.js",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      `file:${fileURLToPath(new URL("./prisma/dev.db", import.meta.url))}`,
  },
});

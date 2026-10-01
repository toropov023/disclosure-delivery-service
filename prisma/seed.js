import { prisma } from "../src/utils/db.js";
import { seedSampleData } from "./seed-data.js";

try {
  await seedSampleData(prisma);
  console.log("Sample data ready.");
} catch (error) {
  console.error("Failed to seed sample data:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

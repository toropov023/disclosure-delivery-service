import express from "express";
import { requireUserId } from "./middleware/requireUserId.js";
import deliveryRoutes from "./routes/deliveryRoutes.js";
import disclosureRoutes from "./routes/disclosureRoutes.js";

export const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/deliveries", requireUserId, deliveryRoutes);
app.use("/clients", requireUserId, disclosureRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

// Express forwards rejected async handlers here.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = error.status ?? 500;
  let message = error.message;

  if (error.type === "entity.parse.failed") {
    message = "Request body must be valid JSON.";
  }

  if (status >= 500) {
    console.error(error);
    message = "Internal server error.";
  }

  res.status(status).json({ error: message });
});

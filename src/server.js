import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, (error) => {
  if (error) {
    throw error;
  }

  console.log(`Server running at http://localhost:${port}`);
});

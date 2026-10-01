import { app } from "./app.js";

const port = process.env.PORT || 3000;

app.listen(port, (error) => {
  if (error) {
    throw error;
  }

  console.log(`Server running at http://localhost:${port}`);
});

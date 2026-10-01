import { Router } from "express";
import {
  createDelivery,
  getDelivery,
  retryDelivery,
} from "../controllers/deliveryController.js";

const router = Router();

router.post("/", createDelivery);
router.get("/:id", getDelivery);
router.post("/:id/retry", retryDelivery);

export default router;

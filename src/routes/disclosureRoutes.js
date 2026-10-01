import { Router } from "express";
import { getReceivedDisclosures } from "../controllers/disclosureController.js";

const router = Router();

router.get("/:clientId/disclosures", getReceivedDisclosures);

export default router;

import * as deliveryService from "../services/deliveryService.js";
import { httpError } from "../utils/httpError.js";

/**
 * Send needed disclosure versions to one of the advisor's clients
 * POST /deliveries
 *
 * @param {object} req - Express request
 * @param {string} req.userId - Advisor ID set by the caller middleware
 * @param {object} req.body - JSON body
 * @param {string} req.body.clientId - Client receiving the disclosures
 * @param {string[]} req.body.fundIds - Funds whose current disclosures are needed
 * @param {object} res - Express response
 * @returns {Promise<void>} Sends 200 with new or active deliveries; received versions are omitted
 * @throws {Error} Invalid input (400), denied client access (403), or no published disclosure (404)
 */
export async function createDelivery(req, res) {
  const { clientId, fundIds } = req.body ?? {};

  if (typeof clientId !== "string" || !clientId.trim()) {
    throw httpError(400, "Client ID must be a non-empty string.");
  }

  const deliveries = await deliveryService.deliverDisclosures(
    req.userId,
    clientId,
    fundIds,
  );

  res.json(deliveries);
}

/**
 * Return a delivery, refreshing accepted messages with the provider
 * GET /deliveries/:id
 *
 * @param {object} req - Express request
 * @param {string} req.userId - Advisor ID set by the caller middleware
 * @param {object} req.params - Route parameters
 * @param {string} req.params.id - Delivery ID
 * @param {object} res - Express response
 * @returns {Promise<void>} Sends 200 with the current delivery record
 * @throws {Error} Missing caller header (400), or a missing or inaccessible delivery (404)
 */
export async function getDelivery(req, res) {
  const delivery = await deliveryService.getDeliveryStatus(
    req.userId,
    req.params.id,
  );

  res.json(delivery);
}

/**
 * Retry a pending or unknown delivery using its original provider key
 * POST /deliveries/:id/retry
 *
 * @param {object} req - Express request
 * @param {string} req.userId - Advisor ID set by the caller middleware
 * @param {object} req.params - Route parameters
 * @param {string} req.params.id - Delivery ID
 * @param {object} res - Express response
 * @returns {Promise<void>} Sends 200 with the delivery's state after one attempt
 * @throws {Error} Invalid input (400), missing or inaccessible delivery (404), or blocked retry (409)
 */
export async function retryDelivery(req, res) {
  const delivery = await deliveryService.retryDelivery(
    req.userId,
    req.params.id,
  );

  res.json(delivery);
}

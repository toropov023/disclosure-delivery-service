import * as disclosureService from "../services/disclosureService.js";
import { httpError } from "../utils/httpError.js";

/**
 * List the document versions a client had received by the requested time
 * GET /clients/:clientId/disclosures?asOf=...
 *
 * @param {object} req - Express request
 * @param {string} req.userId - Compliance user or advisor ID set by the caller middleware
 * @param {object} req.params - Route parameters
 * @param {string} req.params.clientId - Client whose history is requested
 * @param {object} req.query - Query parameters
 * @param {string} req.query.asOf - Receipt cutoff, inclusive, as a date string
 * @param {object} res - Express response
 * @returns {Promise<void>} Sends 200 with the earliest receipt event for each document version
 * @throws {Error} Invalid input (400) or denied access to the client's history (403)
 */
export async function getReceivedDisclosures(req, res) {
  const { asOf } = req.query;

  if (typeof asOf !== "string" || !asOf.trim()) {
    throw httpError(400, "An as-of date is required.");
  }

  const disclosures = await disclosureService.getReceivedDisclosures(
    req.userId,
    req.params.clientId,
    asOf,
  );

  res.json(disclosures);
}

import { httpError } from "../utils/httpError.js";

/**
 * Require X-User-Id and make it available to controllers as req.userId
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {Function} next - Continue to the route handler
 * @returns {void}
 * @throws {Error} Missing or empty header (400)
 */
export function requireUserId(req, res, next) {
  const userId = req.get("X-User-Id");

  if (typeof userId !== "string" || !userId.trim()) {
    throw httpError(400, "X-User-Id header is required.");
  }

  req.userId = userId;
  next();
}

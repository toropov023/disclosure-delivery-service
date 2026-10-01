/** Create an expected error with its HTTP response status */
export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

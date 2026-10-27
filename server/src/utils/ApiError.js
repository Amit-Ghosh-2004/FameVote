class ApiError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.isApiError = true;
  }
  static badRequest(msg = 'Bad request', code = 'BAD_REQUEST', details) { return new ApiError(400, msg, code, details); }
  static unauthorized(msg = 'Authentication required', code = 'UNAUTHORIZED') { return new ApiError(401, msg, code); }
  static forbidden(msg = 'You do not have permission to do that', code = 'FORBIDDEN') { return new ApiError(403, msg, code); }
  static notFound(msg = 'Not found', code = 'NOT_FOUND') { return new ApiError(404, msg, code); }
  static conflict(msg = 'Conflict', code = 'CONFLICT', details) { return new ApiError(409, msg, code, details); }
  static unprocessable(msg = 'Unprocessable', code = 'UNPROCESSABLE', details) { return new ApiError(422, msg, code, details); }
  static tooMany(msg = 'Too many requests', code = 'RATE_LIMITED') { return new ApiError(429, msg, code); }
  static unavailable(msg = 'Service unavailable', code = 'UNAVAILABLE') { return new ApiError(503, msg, code); }
}
module.exports = ApiError;

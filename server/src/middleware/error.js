const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const notFound = (req, _res, next) => next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message;
  let details = err.details;

  if (err.name === 'ValidationError' && err.errors) {
    status = 422; code = 'VALIDATION_ERROR';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    message = 'Validation failed';
  } else if (err.name === 'CastError') {
    status = 400; code = 'BAD_ID'; message = 'Invalid identifier';
  } else if (err.code === 11000) {
    status = 409; code = 'DUPLICATE'; message = 'A record with these details already exists';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_JSON'; message = 'Malformed JSON body';
  } else if (err.name === 'MulterError') {
    status = 400; code = 'UPLOAD_ERROR';
  } else if (!err.isApiError && status >= 500) {
    message = 'Something went wrong on our side';
  }

  res.set('Cache-Control', 'no-store'); // an error must never be reused from a cache, whatever the route set earlier

  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}), ...(env.isProd || status < 500 ? {} : { stack: err.stack }) },
  });
}

module.exports = { notFound, errorHandler };

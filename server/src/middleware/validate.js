const ApiError = require('../utils/ApiError');

/** validate({ body, query, params }) with zod schemas. Parsed values replace the originals. */
const validate = (schemas) => (req, _res, next) => {
  try {
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        throw ApiError.unprocessable('Validation failed', 'VALIDATION_ERROR', details);
      }
      if (part === 'query') {
        Object.keys(req.query).forEach((k) => delete req.query[k]);
        Object.assign(req.query, result.data);
      } else {
        req[part] = result.data;
      }
    }
    next();
  } catch (e) {
    next(e);
  }
};

module.exports = validate;

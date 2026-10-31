require('dotenv').config();
const { z } = require('zod');

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  ADMIN_JWT_SECRET: z.string().min(32, 'ADMIN_JWT_SECRET must be at least 32 chars'),
  RECEIPT_HMAC_SECRET: z.string().min(32, 'RECEIPT_HMAC_SECRET must be at least 32 chars'),

  CLIENT_URL: z.string().default('http://localhost:5173'),
  SERVER_URL: z.string().default('http://localhost:5000'),
  COOKIE_DOMAIN: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().default(15000),

  // Brevo transactional email (REST API, not SMTP)
  BREVO_API_KEY: z.string().optional(),
  EMAIL_FROM_EMAIL: z.string().email().default('no-reply@famevote.example'),
  EMAIL_FROM_NAME: z.string().default('FameVote'),

  // Google Sign-In (Web client ID from Google Cloud Console)
  GOOGLE_CLIENT_ID: z.string().optional(),
  // Phone (OTP) sign-in. 'console' prints the code and is refused in production; leave 'none' to hide phone sign-in.
  SMS_PROVIDER: z.enum(['none', 'console', 'twilio', 'msg91']).default('none'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(), // Twilio Verify Service SID (VA...)
  TWILIO_FROM: z.string().optional(), // Used only by legacy Programmable Messaging integrations
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),

  CAMPAIGN_TIMEZONE: z.string().default('Asia/Kolkata'),
  CAMPAIGN_CUTOFF_TIME: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).default('23:59:59'),
  FINALIZE_GRACE_MINUTES: z.coerce.number().default(30),
  AUTO_FINALIZE_AFTER_HOURS: z.coerce.number().default(1), // results are ready on the last day of the month
  AUTO_PUBLISH_RESULTS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  AUTO_REFUND: bool(true),
  ENABLE_SCHEDULER: bool(true),

  // MongoDB driver tuning (defaults suit one small Render instance talking to Atlas)
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  MONGO_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(50).default(2),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  MONGO_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(5000).default(45_000),
  MONGO_COMPRESSORS: z.string().optional(), // e.g. "zlib" (opt-in; off by default)

  // Boot-time bootstrap (runs after the server is already listening; see services/bootstrapService)
  BOOTSTRAP_ENABLED: bool(true),
  BOOTSTRAP_CELEBRITIES: bool(true), // also insert missing seed celebrities; false = settings/categories/campaigns/gender only

  // Outbound call timeouts (ms)
  RAZORPAY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  CLOUDINARY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  GOOGLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(8_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),

  SUPERADMIN_EMAIL: z.string().optional(),
  SUPERADMIN_PASSWORD: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${msg}`);
  process.exit(1);
}

const env = parsed.data;

// Misconfigurations that would otherwise fail silently (no login, no cookies, forgeable tokens) stop the boot with a clear reason.
const problems = [];
if (env.NODE_ENV !== 'test') {
  if (new Set([env.JWT_SECRET, env.ADMIN_JWT_SECRET, env.RECEIPT_HMAC_SECRET]).size !== 3) problems.push('JWT_SECRET, ADMIN_JWT_SECRET and RECEIPT_HMAC_SECRET must all be different values');
  if (/replace-with/i.test(env.JWT_SECRET + env.ADMIN_JWT_SECRET + env.RECEIPT_HMAC_SECRET)) problems.push('replace the placeholder secrets from .env.example with generated values');
}
if (env.NODE_ENV === 'production') {
  const origins = env.CLIENT_URL.split(',').map((s) => s.trim());
  if (origins.some((o) => !/^https:\/\//i.test(o) || /localhost|127\.0\.0\.1/.test(o))) problems.push('CLIENT_URL must be your public https:// frontend URL (cookies are SameSite=None; Secure and will not work over http or localhost)');
  if (/localhost|127\.0\.0\.1/.test(env.SERVER_URL)) problems.push('SERVER_URL must be your public API URL, not localhost');
  if (env.SMS_PROVIDER === 'console') problems.push('SMS_PROVIDER=console prints one-time codes to the log; use twilio or msg91 in production (or none to turn phone sign-in off)');
}
if (problems.length) {
  console.error(`Invalid environment configuration:\n${problems.map((m) => `  - ${m}`).join('\n')}`);
  process.exit(1);
}
env.smsProblem = (() => {
  if (env.SMS_PROVIDER === 'twilio' && !(env.TWILIO_ACCOUNT_SID?.startsWith('AC') && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID?.startsWith('VA'))) return 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID are required for Twilio Verify';
  if (env.SMS_PROVIDER === 'msg91' && !(env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID)) return 'MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required for SMS_PROVIDER=msg91';
  return null;
})();
if (env.smsProblem && env.NODE_ENV !== 'test') console.warn(`[config] Phone sign-in is OFF: ${env.smsProblem}`);
/** Phone sign-in is offered only when a working SMS provider is configured. */
env.phoneLoginEnabled = env.SMS_PROVIDER !== 'none' && !env.smsProblem;
env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';
env.clientOrigins = env.CLIENT_URL.split(',').map((s) => s.trim().replace(/\/$/, ''));

module.exports = env;

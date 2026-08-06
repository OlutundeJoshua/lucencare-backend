import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  wsCorsOrigin: process.env.WS_CORS_ORIGIN ?? 'http://localhost:3001',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',

  redisHost: process.env.REDIS_HOST ?? 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  redisUsername: process.env.REDIS_USERNAME ?? 'default',
  redisPassword: process.env.REDIS_PASSWORD,
  redisTls: (process.env.REDIS_TLS ?? 'false') === 'true',

  throttleTtl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
  throttleLimit: parseInt(process.env.THROTTLE_LIMIT ?? '60', 10),
  authThrottleTtl: parseInt(process.env.AUTH_THROTTLE_TTL ?? '60', 10),
  authThrottleLimit: parseInt(process.env.AUTH_THROTTLE_LIMIT ?? '10', 10),
  otpThrottleTtl: parseInt(process.env.OTP_THROTTLE_TTL ?? '300', 10),
  otpThrottleLimit: parseInt(process.env.OTP_THROTTLE_LIMIT ?? '3', 10),
  exportThrottleTtl: parseInt(process.env.EXPORT_THROTTLE_TTL ?? '60', 10),
  exportThrottleLimit: parseInt(process.env.EXPORT_THROTTLE_LIMIT ?? '5', 10),

  otpTtlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),

  // COUPLED PAIR — keep these consistent. Each tick claims the doses scheduled in
  // the next `window` minutes, so the window must be >= the tick interval or doses
  // falling between two ticks are never reminded. Making it larger instead sends a
  // dose's reminder on more than one tick. Default: tick every 30 min, window 30 min.
  medicationReminderTickCron: process.env.MEDICATION_REMINDER_TICK_CRON ?? '*/30 * * * *',
  medicationReminderWindowMinutes: parseInt(
    process.env.MEDICATION_REMINDER_WINDOW_MINUTES ?? '30',
    10,
  ),

  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  s3Bucket: process.env.S3_BUCKET ?? 'lucencare-exports',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
}));

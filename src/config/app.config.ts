import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  wsCorsOrigin: process.env.WS_CORS_ORIGIN ?? 'http://localhost:3001',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:4200',

  // The refresh cookie can only travel on cross-SITE requests when it is
  // SameSite=None; Secure; Partitioned. Set this to true wherever the API and the SPA
  // sit on different registrable domains — e.g. the Render API answering a frontend on
  // localhost or a preview URL. Leave it false when both share a site
  // (api.lucencare.com + lucencare.com), where SameSite=Strict is sent normally and is
  // the safer choice.
  crossSiteCookies: (process.env.CROSS_SITE_COOKIES ?? 'false') === 'true',

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

  // How long after its scheduled time a dose stays actionable before the sweep
  // marks it MISSED. Both graces must exceed DUE_NOW_WINDOW_MINUTES (15) in
  // medications.service.ts, or a dose would be marked missed while the schedule
  // is still telling the patient to take it. LATER gets the longer window
  // because the patient explicitly deferred that dose rather than ignoring it.
  medicationDoseGraceMinutes: parseInt(process.env.MEDICATION_DOSE_GRACE_MINUTES ?? '60', 10),
  medicationLaterDoseGraceMinutes: parseInt(
    process.env.MEDICATION_LATER_DOSE_GRACE_MINUTES ?? '120',
    10,
  ),
  // Not coupled to the graces — the sweep only ever marks doses already past
  // grace, so a slower tick delays persistence without ever marking one early.
  medicationMissedSweepCron: process.env.MEDICATION_MISSED_SWEEP_CRON ?? '*/15 * * * *',

  // COUPLED PAIR — same rule as the medication reminder above, and for the same reason:
  // each tick claims the appointments falling in the next `window` minutes at each lead,
  // so window must EQUAL the tick interval. Smaller and appointments between two ticks
  // are never reminded; larger and the same reminder goes out on more than one tick.
  // 5 minutes rather than 30 because one of the leads is the appointment's own start
  // time, where being up to half an hour early would be plainly wrong.
  appointmentReminderTickCron: process.env.APPOINTMENT_REMINDER_TICK_CRON ?? '*/5 * * * *',
  appointmentReminderWindowMinutes: parseInt(
    process.env.APPOINTMENT_REMINDER_WINDOW_MINUTES ?? '5',
    10,
  ),

  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  s3Bucket: process.env.S3_BUCKET ?? 'lucencare-exports',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
}));

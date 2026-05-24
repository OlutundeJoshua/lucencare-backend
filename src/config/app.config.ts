// TODO: Implement — see docs/modules/config.md

import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  wsCorsOrigin: process.env.WS_CORS_ORIGIN ?? 'http://localhost:3001',

  redisHost: process.env.REDIS_HOST ?? 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD,

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

  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  s3Bucket: process.env.S3_BUCKET ?? 'lucencare-exports',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
}));

import { registerAs } from '@nestjs/config';

/**
 * Treats a blank env var as unset. `??` alone would not: `.env.example` ships these
 * branding keys present-but-empty so they are discoverable, and `'' ?? fallback` is
 * `''` — which would put an empty `src=""` in every email header.
 */
const orDefault = (value: string | undefined, fallback: string): string =>
  value && value.trim() !== '' ? value.trim() : fallback;

const frontendUrl = orDefault(process.env.FRONTEND_URL, 'http://localhost:4200');

export default registerAs('mail', () => ({
  host: process.env.SMTP_HOST ?? 'localhost',
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  from: process.env.MAIL_FROM ?? 'LucenCare <no-reply@lucencare.com>',

  /**
   * Absolute URL of the logo in the branded email header. Must be a PNG served over
   * HTTPS in production — Gmail and Outlook do not render SVG in email at all, and a
   * relative path has nothing to resolve against inside an inbox.
   *
   * Defaults to the asset shipped with the frontend. The header band itself is a
   * painted table cell, so a broken or blocked image degrades to indigo with alt text
   * rather than to a blank gap.
   */
  logoUrl: orDefault(process.env.MAIL_LOGO_URL, `${frontendUrl}/logo-email.png`),

  /** Where the header logo and footer link point. */
  brandUrl: orDefault(process.env.MAIL_BRAND_URL, frontendUrl),

  /** Shown in the email footer as the reply-to-a-human route. Must be a mailbox that
   * actually receives mail — it is the only reply path a recipient is given. */
  supportEmail: orDefault(process.env.MAIL_SUPPORT_EMAIL, 'lucencare@gmail.com'),
}));

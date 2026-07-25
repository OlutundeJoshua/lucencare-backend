export interface SendOtpJob {
  to: string;
  code: string;
  expiresInMinutes: number;
}

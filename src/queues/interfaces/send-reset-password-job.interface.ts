export interface SendResetPasswordJob {
  to: string;
  token: string;
  expiresInMinutes: number;
}

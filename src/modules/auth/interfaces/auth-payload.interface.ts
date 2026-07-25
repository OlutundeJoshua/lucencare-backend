export interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name?: string; email: string; role: string; status: string; orgId?: string };
}

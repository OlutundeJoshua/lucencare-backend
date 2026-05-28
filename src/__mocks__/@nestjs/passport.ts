// Stub for @nestjs/passport — the real package is intentionally deferred (CLAUDE.md §10.6).
// Remove this file once @nestjs/passport is installed.

export const AuthGuard = (_strategy: string) =>
  class {
    canActivate() {
      return true;
    }
    handleRequest(_err: unknown, user: unknown) {
      return user;
    }
  };

import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_KEY = 'allowPending';

/**
 * Opts a route out of the account-status check in JwtAuthGuard, letting a user
 * whose account is still 'pending' verification through.
 *
 * Only for routes a pending user legitimately needs: submitting their onboarding
 * application, reading their own status, and signing out. Never on a route that
 * returns or mutates platform data.
 */
export const AllowPending = () => SetMetadata(ALLOW_PENDING_KEY, true);

import { createPublicKey } from 'crypto';

import { ConfigService } from '@nestjs/config';

/**
 * RS256 signs with jwt.privateKey and verifies with jwt.publicKey, and nothing in the
 * request path ever compares the two. When they are not a pair the failure is silent and
 * looks like a client bug: POST /auth/login returns 200 because signing only needs the
 * private key, while every authenticated route 401s with "Missing or expired JWT" — the
 * same message an unauthenticated request gets. Two separate environment variables
 * holding two halves of one key pair drift easily (a rotation that updated one of them,
 * a truncated paste), so assert the pairing at boot rather than discovering it per
 * request.
 */
export function assertJwtKeyPair(configService: ConfigService): void {
  const privateKey = configService.get<string>('jwt.privateKey') ?? '';
  const publicKey = configService.get<string>('jwt.publicKey') ?? '';

  if (!privateKey || !publicKey) {
    throw new Error(
      'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must both be set to a matching RS256 PEM pair.',
    );
  }

  let derivedFromPrivate: string;
  let provided: string;
  try {
    derivedFromPrivate = createPublicKey(privateKey)
      .export({ type: 'spki', format: 'pem' })
      .toString();
    provided = createPublicKey(publicKey).export({ type: 'spki', format: 'pem' }).toString();
  } catch (err) {
    // Most often a multi-line PEM that lost its newlines in the deployment environment.
    throw new Error(`JWT keys are not readable as PEM: ${(err as Error).message}`);
  }

  if (derivedFromPrivate !== provided) {
    throw new Error(
      'JWT_PUBLIC_KEY is not the public half of JWT_PRIVATE_KEY. Login would succeed and ' +
        'every authenticated request would return 401. Regenerate the pair and set both ' +
        'variables from the same generation.',
    );
  }
}

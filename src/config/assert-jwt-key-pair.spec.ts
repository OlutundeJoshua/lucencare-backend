import { generateKeyPairSync } from 'crypto';

import { ConfigService } from '@nestjs/config';

import { assertJwtKeyPair } from './assert-jwt-key-pair';

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey: privateKey as unknown as string, publicKey: publicKey as unknown as string };
}

function configWith(privateKey: string, publicKey: string): ConfigService {
  return {
    get: (key: string) => (key === 'jwt.privateKey' ? privateKey : publicKey),
  } as unknown as ConfigService;
}

describe('assertJwtKeyPair', () => {
  it('accepts a matching pair', () => {
    const { privateKey, publicKey } = pair();
    expect(() => assertJwtKeyPair(configWith(privateKey, publicKey))).not.toThrow();
  });

  it('rejects a public key from a different pair', () => {
    const { privateKey } = pair();
    const { publicKey } = pair();
    expect(() => assertJwtKeyPair(configWith(privateKey, publicKey))).toThrow(
      /not the public half/,
    );
  });

  it('rejects a missing key', () => {
    const { privateKey } = pair();
    expect(() => assertJwtKeyPair(configWith(privateKey, ''))).toThrow(/must both be set/);
  });

  it('rejects a PEM that lost its newlines', () => {
    const { privateKey, publicKey } = pair();
    expect(() =>
      assertJwtKeyPair(configWith(privateKey, publicKey.replace(/\n/g, ''))),
    ).toThrow(/not readable as PEM/);
  });
});

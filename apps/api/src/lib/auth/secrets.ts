import { randomBytes, createHash } from 'node:crypto';

/**
 * The one way this API mints and stores a bearer secret — API tokens, invite
 * links and email-verification links all share it.
 *
 * SHA-256, not scrypt: every secret here is 32 bytes from a CSPRNG, so there is
 * no low-entropy guess for a work factor to slow down. Only the hash is ever
 * stored, so a leaked database dump cannot be replayed.
 */

/** 32 bytes of CSPRNG, URL-safe — these travel as path segments. */
export function mintSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of a secret, as stored in the database. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

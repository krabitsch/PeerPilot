import { describe, expect, it } from 'vitest';
import { sameTokenAccount } from './token-account';

const token = (userId: unknown) => `header.${btoa(JSON.stringify({ userId }))}.signature`;

describe('refresh account identity', () => {
  it('accepts refresh for the same account', () => {
    expect(sameTokenAccount(token(2), token(2))).toBe(true);
  });

  it('rejects a student refresh token for a Bocal session', () => {
    expect(sameTokenAccount(token(2), token(4))).toBe(false);
  });

  it('rejects missing or malformed account identities', () => {
    expect(sameTokenAccount(null, token(2))).toBe(false);
    expect(sameTokenAccount('malformed', token(2))).toBe(false);
    expect(sameTokenAccount(token(null), token(null))).toBe(false);
  });
});

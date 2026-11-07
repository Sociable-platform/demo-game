import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/connection.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The browser gets a random 256-bit token; only its sha256 is stored, so a DB leak cannot be replayed. */
export function createSession(db: Db, userId: string, now: number, ttlMs: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + ttlMs;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now,
    expiresAt,
  );
  return { token, expiresAt };
}

export interface SessionUser {
  userId: string;
  username: string;
  createdAt: number;
}

export function findSessionUser(db: Db, token: string, now: number): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id AS userId, u.username AS username, u.created_at AS createdAt
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now) as SessionUser | undefined;
  return row ?? null;
}

export function deleteSession(db: Db, token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function deleteExpiredSessions(db: Db, now: number) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
}

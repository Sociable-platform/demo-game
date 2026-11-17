import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Db } from '../db/connection.js';
import type { Config } from '../config.js';
import { AppError } from '../http/errors.js';
import { rateLimit } from '../http/rateLimit.js';
import { fakeVerify, hashPassword, verifyPassword } from './passwords.js';
import { usernameSql } from './usernames.js';
import { createSession, deleteExpiredSessions, deleteSession } from './sessions.js';
import type { RequestHandler } from 'express';
import type { DeleteAccount } from './delete-account.js';

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be 3-20 characters.')
    .max(20, 'Username must be 3-20 characters.')
    .regex(/^[A-Za-z0-9_]+$/, 'Username may only contain letters, numbers and underscores.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(72, 'Password must be at most 72 characters.'),
});

interface Deps {
  db: Db;
  config: Config;
  now: () => number;
  requireAuth: RequestHandler;
  /** Called inside the registration transaction so game code can create its own rows for the new user. */
  onUserCreated: (userId: string) => void;
  deleteAccount: DeleteAccount;
}

export function createUser(
  db: Db,
  now: number,
  username: string,
  passwordHash: string,
  onUserCreated: (userId: string) => void,
): string {
  username = username.trim();
  const id = randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      username,
      passwordHash,
      now,
    );
    onUserCreated(id);
  }).immediate();
  return id;
}

export function createAuthRouter({ db, config, now, requireAuth, onUserCreated, deleteAccount }: Deps): Router {
  const router = Router();

  const setCookie = (res: Response, token: string) =>
    res.cookie(config.cookieName, token, {
      httpOnly: true, // not readable from JS
      secure: config.cookieSecure, // true in production (and required by the __Host- prefix)
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionTtlMs,
    });

  const clearCookie = (res: Response) =>
    res.clearCookie(config.cookieName, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });

  const registerLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    key: (req) => `reg:${req.ip}`,
    enabled: config.rateLimitEnabled,
  });
  const loginLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    key: (req) => `login:${req.ip}:${String(req.body?.username ?? '').trim().toLowerCase()}`,
    enabled: config.rateLimitEnabled,
  });

  router.post('/register', registerLimit, async (req, res) => {
    const { username, password } = credentialsSchema.parse(req.body);
    // Fast feedback before hashing; the unique index also guards the insert
    // after hashing, when concurrent registrations may have claimed the name.
    if (db.prepare(`SELECT id FROM users WHERE ${usernameSql} = ?`).get(username)) {
      throw new AppError(409, 'username_taken', 'This username is already taken.');
    }
    const passwordHash = await hashPassword(password);
    let userId: string;
    try {
      userId = createUser(db, now(), username, passwordHash, onUserCreated);
    } catch (err) {
      const e = err as { code?: string; errcode?: number };
      if (e.errcode === 2067 || e.code === 'SQLITE_CONSTRAINT_UNIQUE') { // 2067 = SQLITE_CONSTRAINT_UNIQUE
        throw new AppError(409, 'username_taken', 'This username is already taken.');
      }
      throw err;
    }
    deleteExpiredSessions(db, now());
    const session = createSession(db, userId, now(), config.sessionTtlMs);
    setCookie(res, session.token);
    res.status(201).json({ user: { id: userId, username, createdAt: now() } });
  });

  router.post('/login', loginLimit, async (req, res) => {
    const { username, password } = credentialsSchema.parse(req.body);
    const row = db
      .prepare(`SELECT id, username, password_hash AS hash, created_at AS createdAt FROM users WHERE ${usernameSql} = ?`)
      .get(username) as { id: string; username: string; hash: string; createdAt: number } | undefined;
    const ok = row ? await verifyPassword(password, row.hash) : (await fakeVerify(password), false);
    if (!row || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid username or password.');
    deleteExpiredSessions(db, now());
    const session = createSession(db, row.id, now(), config.sessionTtlMs);
    setCookie(res, session.token);
    res.json({ user: { id: row.id, username: row.username, createdAt: row.createdAt } });
  });

  router.post('/logout', (req, res) => {
    const token = req.cookies?.[config.cookieName];
    if (typeof token === 'string') deleteSession(db, token);
    clearCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    const u = req.auth!;
    res.json({ user: { id: u.userId, username: u.username, createdAt: u.createdAt } });
  });

  router.delete('/account', requireAuth, async (req, res) => {
    await deleteAccount(req.auth!.userId);
    clearCookie(res);
    res.json({ ok: true });
  });

  return router;
}

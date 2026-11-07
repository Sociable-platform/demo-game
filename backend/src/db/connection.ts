import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite via Node's built-in `node:sqlite` (Node 22.13+): no native module to compile, so `npm install`
 * works the same on Windows, macOS and Linux. This thin wrapper exposes the small API the app uses.
 */
export interface Statement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

type TxFn<A extends unknown[], R> = ((...args: A) => R) & { immediate: (...args: A) => R };

export class Db {
  private readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string): Statement {
    const stmt = this.raw.prepare(sql);
    return {
      run: (...p) => ({ changes: Number(stmt.run(...(p as never[])).changes) }),
      get: (...p) => stmt.get(...(p as never[])),
      all: (...p) => stmt.all(...(p as never[])),
    };
  }

  /** Wraps fn in BEGIN/COMMIT (ROLLBACK if it throws). `.immediate` takes the write lock up front (BEGIN IMMEDIATE). */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): TxFn<A, R> {
    const make =
      (mode: 'DEFERRED' | 'IMMEDIATE') =>
      (...args: A): R => {
        this.raw.exec(`BEGIN ${mode}`);
        try {
          const result = fn(...args);
          this.raw.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            this.raw.exec('ROLLBACK');
          } catch {
            /* transaction already ended */
          }
          throw err;
        }
      };
    const tx = make('DEFERRED') as TxFn<A, R>;
    tx.immediate = make('IMMEDIATE');
    return tx;
  }

  close(): void {
    this.raw.close();
  }
}

export function openDb(file: string): Db {
  return new Db(file);
}

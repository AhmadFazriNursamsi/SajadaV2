import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export interface DbHandle {
  db: Database;
  driver: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

/**
 * PGlite hanya aman dipakai satu proses per folder; dua proses sekaligus merusak data.
 * Kunci berbasis PID: tolak start bila proses lain yang masih hidup memegang folder yang sama.
 */
function lockDataDir(dir: string): () => void {
  const file = join(dir, 'sajadah.lock');
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = pid !== process.pid; } catch { /* proses sudah mati: kunci basi */ }
    if (alive) throw new Error(`Folder data PGlite (${dir}) sedang dipakai proses PID ${pid}. Hentikan proses itu dulu, atau set DATABASE_URL ke PostgreSQL / PGLITE_DIR ke folder lain.`);
  }
  writeFileSync(file, String(process.pid));
  const release = () => { try { if (Number(readFileSync(file, 'utf8')) === process.pid) unlinkSync(file); } catch { /* sudah hilang */ } };
  process.once('exit', release);
  return release;
}

const MIGRATIONS = resolve(__dirname, '../../drizzle');

/**
 * Pilih driver: DATABASE_URL → PostgreSQL (node-postgres), selain itu PGlite embedded.
 * `memory://` memakai PGlite in-memory (dipakai test).
 */
export async function createDb(url = process.env.DATABASE_URL, dataDir = process.env.PGLITE_DIR ?? join(process.cwd(), '.data/pglite')): Promise<DbHandle> {
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Database, driver: 'postgres', close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const memory = url === 'memory://';
  let release = () => {};
  if (!memory) { mkdirSync(dataDir, { recursive: true }); release = lockDataDir(dataDir); }
  const client = new PGlite(memory ? undefined : dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Database, driver: 'pglite', close: async () => { await client.close(); release(); } };
}

export { schema };

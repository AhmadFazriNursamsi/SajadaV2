import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp, webDist } from './bootstrap';
import { seedIfEmpty } from './seed/seed';
import { DB } from './core/db.module';
import type { Database } from './db/db';

async function main() {
  try { process.loadEnvFile(); } catch { /* tanpa .env: pakai bawaan (PGlite) */ }
  const app = await createApp();
  if (process.env.SEED !== 'false') await seedIfEmpty(app.get<Database>(DB));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  const log = new Logger('Sajadah');
  log.log(`Satu port: http://localhost:${port}  (web: /, API: /api, health: /api/health)`);
  log.log(`Web build: ${webDist()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

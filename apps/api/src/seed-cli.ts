import 'reflect-metadata';
import { createDb } from './db/db';
import { seedDemo } from './seed/seed';

(async () => {
  const h = await createDb();
  await seedDemo(h.db);
  console.log('Seed selesai');
  await h.close();
})().catch((e) => { console.error(e); process.exit(1); });

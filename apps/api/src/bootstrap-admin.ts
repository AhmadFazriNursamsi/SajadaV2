import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb } from './db/db';
import { commissionPlans, tenants, users } from './db/schema';
import { hashPassword } from './auth/password';

/**
 * Buat koperasi dan akun pengurus pertama di database produksi yang masih kosong (tanpa data demo).
 * Aman dijalankan ulang: bila koperasi dengan slug itu sudah ada, tidak ada yang diubah.
 *
 * Env (semua opsional): BOOTSTRAP_TENANT_NAME, BOOTSTRAP_TENANT_SLUG, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD.
 * Tanpa BOOTSTRAP_ADMIN_PASSWORD dibuat sandi acak yang dicetak sekali di sini. Pengurus wajib menggantinya saat login pertama.
 */
(async () => {
  try { process.loadEnvFile(); } catch { /* env dari lingkungan */ }
  const name = process.env.BOOTSTRAP_TENANT_NAME?.trim() || 'Koperasi Sajadah';
  const slug = (process.env.BOOTSTRAP_TENANT_SLUG?.trim() || 'sajadah').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const adminName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Pengurus';
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME?.trim() || 'admin').toLowerCase();
  const given = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (given && (given.length < 8 || !/[A-Za-z]/.test(given) || !/\d/.test(given))) throw new Error('BOOTSTRAP_ADMIN_PASSWORD minimal 8 karakter, memuat huruf dan angka.');
  const password = given || randomBytes(12).toString('base64url');

  const h = await createDb(); // menjalankan migrasi bila perlu
  try {
    const [exists] = await h.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
    if (exists) { console.log(`Koperasi "${slug}" sudah ada. Tidak ada yang diubah.`); return; }
    const hash = await hashPassword(password);
    await h.db.transaction(async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug, name, cash: 0 }).returning();
      await tx.insert(users).values({ tenantId: t!.id, username, name: adminName, passwordHash: hash, role: 'tenant_admin', mustChangePassword: true });
      await tx.insert(commissionPlans).values({ tenantId: t!.id, rates: [5, 3, 2, 1], reason: 'Tarif awal', createdByName: 'Sistem' });
    });
    console.log('\nKoperasi dan pengurus pertama dibuat.');
    console.log(`  Koperasi : ${name} (${slug})`);
    console.log(`  Username : ${username}`);
    console.log(`  Sandi    : ${password}${given ? '' : '   <- dicetak sekali ini saja, simpan sekarang'}`);
    console.log('Anda akan diminta mengganti sandi saat login pertama.\n');
  } finally { await h.close(); }
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

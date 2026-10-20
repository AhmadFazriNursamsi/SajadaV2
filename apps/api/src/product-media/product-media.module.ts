import { mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Body, Controller, Get, Header, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { productImageSchema } from '@sajadah/shared';
import type { z } from 'zod';
import { Database } from '../db/db';
import { products } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { EXT, MAX_IMAGE_BYTES, TYPE, looksLike } from '../common/image-store';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, Public, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

const FILE = /^[0-9a-f-]{36}-\d+\.(jpg|png|webp)$/;

const dir = () => process.env.PRODUCT_IMAGE_DIR ?? join(process.cwd(), '.data/products');

/** Foto produk untuk tampilan toko anggota: disimpan di disk server, nama berkas baru tiap unggah (aman di-cache). */
@Injectable()
export class ProductMediaService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) { mkdirSync(dir(), { recursive: true }); }

  async upload(a: Actor, id: string, input: z.infer<typeof productImageSchema>) {
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new BusinessError('Foto terlalu besar (maksimal 1 MB).');
    if (!looksLike(input.contentType, bytes)) throw new BusinessError('Isi berkas bukan gambar yang valid.');
    const [p] = await this.db.select().from(products).where(and(eq(products.tenantId, a.tid), eq(products.id, id)));
    if (!p) throw new BusinessError('Produk tidak ditemukan.');
    const file = `${id}-${Date.now()}.${EXT[input.contentType]}`;
    mkdirSync(dir(), { recursive: true });
    await writeFile(join(dir(), file), bytes);
    await this.db.transaction(async (tx) => {
      await tx.update(products).set({ image: file }).where(eq(products.id, id));
      await this.core.audit(tx, a, `Foto produk ${p.sku} diganti`);
    });
    if (p.image && FILE.test(p.image)) await unlink(join(dir(), p.image)).catch(() => undefined);
    return { image: file };
  }

  async read(file: string) {
    if (!FILE.test(file)) throw new NotFoundException();
    const bytes = await readFile(join(dir(), file)).catch(() => null);
    if (!bytes) throw new NotFoundException();
    return { bytes, type: TYPE[file.split('.').pop() as keyof typeof TYPE] };
  }
}

@Controller()
class ProductMediaController {
  constructor(private readonly svc: ProductMediaService) {}
  @Post('central/products/:id/image') @Roles(...ADMIN)
  upload(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productImageSchema)) b: z.infer<typeof productImageSchema>) { return this.svc.upload(a, id, b); }

  /** Publik (gambar produk bukan data rahasia; nama berkas tak bisa ditebak) agar bisa dimuat langsung oleh komponen gambar. */
  @Public() @Get('products/image/:file') @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async image(@Param('file') file: string, @Res({ passthrough: true }) res: { header: (k: string, v: string) => unknown }) {
    const { bytes, type } = await this.svc.read(file);
    res.header('Content-Type', type);
    return bytes;
  }
}

@Module({ controllers: [ProductMediaController], providers: [ProductMediaService] })
export class ProductMediaModule {}

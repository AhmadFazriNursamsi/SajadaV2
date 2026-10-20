import { mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Body, Controller, Get, Header, Injectable, Module, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { productImageSchema } from '@sajadah/shared';
import type { z } from 'zod';
import { Database } from '../db/db';
import { members } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { EXT, MAX_IMAGE_BYTES, TYPE, looksLike } from '../common/image-store';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentActor, Public } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

const FILE = /^[0-9a-f-]{36}-\d+\.(jpg|png|webp)$/;

const dir = () => process.env.AVATAR_DIR ?? join(process.cwd(), '.data/avatars');

/** Foto profil anggota: disimpan di disk server, nama berkas baru tiap unggah (aman di-cache). */
@Injectable()
export class AvatarService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) { mkdirSync(dir(), { recursive: true }); }

  async upload(a: Actor, input: z.infer<typeof productImageSchema>) {
    if (!a.mid) throw new BusinessError('Hanya anggota yang punya foto profil.');
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new BusinessError('Foto terlalu besar (maksimal 1 MB).');
    if (!looksLike(input.contentType, bytes)) throw new BusinessError('Isi berkas bukan gambar yang valid.');
    const [m] = await this.db.select().from(members).where(and(eq(members.tenantId, a.tid), eq(members.id, a.mid)));
    if (!m) throw new BusinessError('Anggota tidak ditemukan.');
    const file = `${m.id}-${Date.now()}.${EXT[input.contentType]}`;
    mkdirSync(dir(), { recursive: true });
    await writeFile(join(dir(), file), bytes);
    await this.db.transaction(async (tx) => {
      await tx.update(members).set({ avatar: file }).where(eq(members.id, m.id));
      await this.core.audit(tx, a, `Foto profil ${m.name} diganti`);
    });
    if (m.avatar && FILE.test(m.avatar)) await unlink(join(dir(), m.avatar)).catch(() => undefined);
    return { avatarUrl: `/api/members/avatar/${file}` };
  }

  async read(file: string) {
    if (!FILE.test(file)) throw new NotFoundException();
    const bytes = await readFile(join(dir(), file)).catch(() => null);
    if (!bytes) throw new NotFoundException();
    return { bytes, type: TYPE[file.split('.').pop() as keyof typeof TYPE] };
  }
}

@Controller()
class AvatarController {
  constructor(private readonly svc: AvatarService) {}
  @Post('me/avatar')
  upload(@CurrentActor() a: Actor, @Body(new ZodPipe(productImageSchema)) b: z.infer<typeof productImageSchema>) { return this.svc.upload(a, b); }

  /** Publik agar komponen gambar bisa memuatnya langsung; nama berkas memuat UUID + waktu sehingga tak bisa ditebak. */
  @Public() @Get('members/avatar/:file') @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async image(@Param('file') file: string, @Res({ passthrough: true }) res: { header: (k: string, v: string) => unknown }) {
    const { bytes, type } = await this.svc.read(file);
    res.header('Content-Type', type);
    return bytes;
  }
}

@Module({ controllers: [AvatarController], providers: [AvatarService] })
export class AvatarModule {}

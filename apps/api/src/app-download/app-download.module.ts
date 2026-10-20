import { createReadStream, existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { Controller, Get, Module, NotFoundException, Req, Res, StreamableFile } from '@nestjs/common';
import { ADMIN, Public, Roles } from '../auth/auth.decorators';

/** Lokasi file APK; bisa diganti dengan APK_PATH. Berkas diletakkan manual oleh pengurus/teknisi. */
const apkPath = () => resolve(process.env.APK_PATH ?? `${process.cwd()}/.data/apk/sajadah.apk`);

/** Alamat yang bisa dijangkau HP: APP_PUBLIC_URL bila diset; bila tidak, alamat Host permintaan, dan jika itu localhost, IP LAN server. */
function baseUrl(req: { headers: Record<string, string | string[] | undefined>; protocol?: string }): string {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  const hostname = host.replace(/:\d+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http');
  if (host && !['localhost', '127.0.0.1', '::1'].includes(hostname)) return `${proto}://${host}`;
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  return `http://${lan ?? 'localhost'}:${process.env.PORT ?? 3000}`;
}

@Controller('app')
class AppDownloadController {
  /** Info untuk halaman admin: ada tidaknya berkas dan tautan unduhan. */
  @Get('info') @Roles(...ADMIN)
  info(@Req() req: any) {
    const p = apkPath();
    const ok = existsSync(p);
    const st = ok ? statSync(p) : null;
    return { available: ok, size: st?.size ?? 0, updatedAt: st?.mtime.toISOString() ?? null, url: `${baseUrl(req)}/api/app/sajadah.apk` };
  }

  /** Unduhan APK tanpa login agar bisa dibuka dari HP lewat pindai QR. Hanya berisi aplikasi, tanpa data koperasi. */
  @Public() @Get('sajadah.apk')
  download(@Res({ passthrough: true }) res: any) {
    const p = apkPath();
    if (!existsSync(p)) throw new NotFoundException('Berkas aplikasi belum tersedia.');
    res.header('Content-Type', 'application/vnd.android.package-archive');
    res.header('Content-Disposition', 'attachment; filename="sajadah.apk"');
    res.header('Content-Length', String(statSync(p).size));
    return new StreamableFile(createReadStream(p));
  }
}

@Module({ controllers: [AppDownloadController] })
export class AppDownloadModule {}

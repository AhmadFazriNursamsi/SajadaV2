import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

/** GET non-/api yang tidak cocok dengan file statis → index.html (SPA); selain itu 404 JSON bawaan Nest. */
@Catch(NotFoundException)
class SpaFallbackFilter implements ExceptionFilter {
  catch(ex: NotFoundException, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<{ method: string; url: string }>();
    const reply = http.getResponse<{ code(n: number): any; header(k: string, v: string): any; send(b: unknown): any; sendFile(f: string): any }>();
    if (req.method === 'GET' && (req.url === '/m' || req.url.startsWith('/m/') || req.url.startsWith('/m?')) && existsSync(join(mobileWebDist(), 'index.html'))) return reply.header('Cache-Control', 'no-cache').sendFile('index.html', mobileWebDist());
    if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    return reply.code(404).send(ex.getResponse());
  }
}

/** Lokasi hasil build web (apps/web/dist). Bisa ditimpa dengan WEB_DIST. */
export const webDist = () => process.env.WEB_DIST ?? resolve(__dirname, '../../web/dist');
/** Hasil build aplikasi mobile versi web (apps/mobile/dist-web), dilayani di /m. Bisa ditimpa dengan MOBILE_WEB_DIST. */
export const mobileWebDist = () => process.env.MOBILE_WEB_DIST ?? resolve(__dirname, '../../mobile/dist-web');

/**
 * Satu port untuk semuanya: API di /api/*, web (SPA) di /.
 * Aplikasi mobile memanggil origin yang sama di /api.
 */
export async function createApp(opts: { serveWeb?: boolean; logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: process.env.TRUST_PROXY === 'true' }), { logger: opts.logger === false ? false : ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  // Produksi: web dan API satu origin, jadi lintas-origin ditolak kecuali CORS_ORIGIN diisi (daftar dipisah koma). Pengembangan: terbuka.
  // `methods` eksplisit: bawaan hanya GET/HEAD/POST, sehingga PUT/PATCH/DELETE lintas-origin diblokir peramban.
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean) ?? (process.env.NODE_ENV === 'production' ? false : true), methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Client'] });
  // Header keamanan dasar untuk semua respons (web dan API).
  const csp = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  app.getHttpAdapter().getInstance().addHook('onSend', async (req: { url: string }, reply: { header(k: string, v: string): unknown }, payload: unknown) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    if (!req.url.startsWith('/api')) reply.header('Content-Security-Policy', csp);
    if (process.env.NODE_ENV === 'production') reply.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    return payload;
  });
  app.enableShutdownHooks();

  const dist = webDist();
  if (opts.serveWeb !== false && existsSync(join(dist, 'index.html'))) {
    const fastifyStatic = (await import('@fastify/static')).default;
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(fastifyStatic, { root: dist, wildcard: false, maxAge: '1h', setHeaders: (res, path) => { if (path.endsWith('index.html')) res.header('Cache-Control', 'no-cache'); } });
    // Mobile versi web di /m (instance statis kedua tidak boleh mendekorasi reply lagi).
    if (existsSync(join(mobileWebDist(), 'index.html'))) {
      await fastify.register(fastifyStatic, { root: mobileWebDist(), prefix: '/m/', wildcard: false, decorateReply: false, maxAge: '1h', setHeaders: (res, path) => { if (path.endsWith('index.html')) res.header('Cache-Control', 'no-cache'); } });
    }
    app.useGlobalFilters(new SpaFallbackFilter());
  }
  return app;
}

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Pembatas percobaan gagal (login, lupa sandi, ganti sandi) di memori proses.
 * Tiga lapis: pasangan IP+kunci (utama), IP saja, dan kunci saja dari banyak IP (serangan terdistribusi).
 * Catatan: hitungan tidak dibagi antar-proses; bila API dijalankan lebih dari satu instance, pasang pembatas di reverse proxy
 * (nginx/Cloudflare) atau pindahkan penyimpanan ke Redis.
 */
@Injectable()
export class LoginLimiter {
  private readonly hits = new Map<string, number[]>();
  readonly maxPerPair = Number(process.env.LOGIN_MAX_FAILS ?? 5);
  readonly maxPerIp = Number(process.env.LOGIN_MAX_FAILS_IP ?? 30);
  readonly maxPerKey = Number(process.env.LOGIN_MAX_FAILS_KEY ?? 25);
  readonly windowMs = Number(process.env.LOGIN_WINDOW_MINUTES ?? 15) * 60_000;

  private fresh(k: string, now: number): number[] {
    const v = (this.hits.get(k) ?? []).filter((t) => now - t < this.windowMs);
    if (v.length) this.hits.set(k, v); else this.hits.delete(k);
    return v;
  }

  private wait(v: number[], max: number, now: number): number {
    return v.length >= max ? Math.max(1, Math.ceil((this.windowMs - (now - v[v.length - max]!)) / 1000)) : 0;
  }

  /** Lempar 429 bila salah satu lapis sudah penuh; dipanggil SEBELUM memeriksa kata sandi. */
  check(scope: string, ip: string, key: string): void {
    const now = Date.now();
    const secs = Math.max(
      this.wait(this.fresh(`${scope}|${ip}|${key}`, now), this.maxPerPair, now),
      this.wait(this.fresh(`${scope}|${ip}`, now), this.maxPerIp, now),
      this.wait(this.fresh(`${scope}||${key}`, now), this.maxPerKey, now),
    );
    if (secs > 0) {
      const mins = Math.ceil(secs / 60);
      throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${mins} menit.`, retryAfterSeconds: secs }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  fail(scope: string, ip: string, key: string): void {
    const now = Date.now();
    for (const k of [`${scope}|${ip}|${key}`, `${scope}|${ip}`, `${scope}||${key}`]) this.hits.set(k, [...this.fresh(k, now), now]);
    if (this.hits.size > 20_000) for (const k of [...this.hits.keys()]) this.fresh(k, now); // buang kunci kedaluwarsa
  }

  /** Login berhasil: hapus hitungan pasangan IP+kunci (hitungan per-IP dan per-kunci tetap sampai kedaluwarsa). */
  success(scope: string, ip: string, key: string): void { this.hits.delete(`${scope}|${ip}|${key}`); }

  reset(): void { this.hits.clear(); }
}

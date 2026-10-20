import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

/** Pelanggaran aturan bisnis (mis. saldo kurang, stok tidak cukup) → HTTP 422. */
export class BusinessError extends UnprocessableEntityException {
  constructor(message: string) {
    super({ statusCode: 422, error: 'Unprocessable Entity', message });
  }
}

export function parse<T extends ZodTypeAny>(schema: T, value: unknown): ReturnType<T['parse']> {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: r.error.issues[0]?.message ?? 'Input tidak valid', issues: r.error.issues });
  return r.data;
}

/** true bila error adalah pelanggaran unique constraint Postgres (23505), termasuk dibungkus Drizzle. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | undefined;
  return err?.code === '23505' || err?.cause?.code === '23505';
}

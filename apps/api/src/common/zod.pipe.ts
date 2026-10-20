import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { parse } from './errors';

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    return parse(this.schema, value);
  }
}

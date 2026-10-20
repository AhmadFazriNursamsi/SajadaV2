import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from './auth/auth.decorators';
import { DB, DB_HANDLE } from './core/db.module';
import type { Database, DbHandle } from './db/db';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database, @Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  @Public() @Get()
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok', db: this.handle.driver, version: process.env.npm_package_version ?? '0.52.0' };
  }
}

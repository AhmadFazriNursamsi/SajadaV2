import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDb, DbHandle, Database } from '../db/db';

export const DB_HANDLE = Symbol('DB_HANDLE');
export const DB = Symbol('DB');
export const InjectDb = () => Inject(DB);

@Injectable()
class DbShutdown implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}
  onApplicationShutdown() {
    return this.handle.close();
  }
}

@Global()
@Module({
  providers: [
    { provide: DB_HANDLE, useFactory: () => createDb() },
    { provide: DB, inject: [DB_HANDLE], useFactory: (h: DbHandle): Database => h.db },
    DbShutdown,
  ],
  exports: [DB, DB_HANDLE],
})
export class DbModule {}

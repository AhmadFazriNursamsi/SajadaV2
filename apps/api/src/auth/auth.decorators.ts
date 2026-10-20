import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@sajadah/shared';
import type { Actor } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const ALLOW_PW_CHANGE = 'allowPasswordChange';
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Boleh diakses walau pengguna masih wajib mengganti kata sandi (mis. /auth/me, ganti kata sandi). */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PW_CHANGE, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor);

/** Pengurus: semua aksi (keuangan, komisi, PO, opname, produk, stok pusat). */
export const ADMIN: Role[] = ['tenant_admin'];
/** Pengurus + petugas toko (petugas terkunci ke tokonya). */
export const STAFF: Role[] = ['tenant_admin', 'staff'];
export const OPS: Role[] = STAFF;
/** Pelaksana toko: hanya petugas. Pengurus melihat dan menyetujui, tidak mengubah stok toko. */
export const DEPOT_ONLY: Role[] = ['staff'];
export const FINANCE: Role[] = ADMIN;

-- Peran Akuntan dan Admin pusat dihapus: akun dengan peran itu dihapus (tugasnya dipegang Pengurus).
DELETE FROM "users" WHERE "role"::text IN ('accountant', 'central_admin');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."role";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('tenant_admin', 'staff', 'member');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";
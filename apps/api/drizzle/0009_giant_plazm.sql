ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_member_uq" ON "users" USING btree ("member_id");
--> statement-breakpoint
-- Konversi akun lama: username = bagian depan email + '.' + nama tenant (admin@nasional.test -> admin.nasional)
UPDATE "users" SET "username" = lower(split_part("email", '@', 1) || '.' || split_part(split_part("email", '@', 2), '.', 1)) WHERE "username" IS NULL;

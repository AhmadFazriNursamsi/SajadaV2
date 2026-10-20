DROP INDEX "users_tenant_email_uq";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_username_uq" ON "users" USING btree ("tenant_id","username");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email";
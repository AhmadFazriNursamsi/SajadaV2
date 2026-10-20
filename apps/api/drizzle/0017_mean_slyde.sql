CREATE TABLE "commission_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rates" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deactivation_reason" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deactivated_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_rates" jsonb DEFAULT '[5,3,2,1]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_approved_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_paid_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_plans_tenant_idx" ON "commission_plans" USING btree ("tenant_id","created_at");--> statement-breakpoint
INSERT INTO "commission_plans" ("tenant_id", "rates", "reason", "created_by_name") SELECT "id", '[5,3,2,1]'::jsonb, 'Tarif awal (kebijakan demo)', 'Sistem' FROM "tenants";--> statement-breakpoint
UPDATE "orders" SET "commission_approved_by" = 'Data lama (sebelum ada jejak)', "commission_approved_at" = "created_at" WHERE "commission" IN ('approved', 'paid');--> statement-breakpoint
UPDATE "orders" SET "commission_paid_by" = 'Data lama (sebelum ada jejak)', "commission_paid_at" = "created_at" WHERE "commission" = 'paid';

CREATE TYPE "public"."region_level" AS ENUM('province', 'regency', 'district', 'village');--> statement-breakpoint
CREATE TABLE "funding_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"level" "region_level" NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "province_name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "province_code" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "regency_name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "regency_code" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "village_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "funding_ref" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "funded_at" date;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "activated_at" date;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "activation_ref" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "budget_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "profit_reports" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "profit_reports" ADD COLUMN "settled_by" uuid;--> statement-breakpoint
ALTER TABLE "funding_allocations" ADD CONSTRAINT "funding_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_allocations" ADD CONSTRAINT "funding_allocations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_allocations" ADD CONSTRAINT "funding_allocations_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funding_member_investor_uq" ON "funding_allocations" USING btree ("member_id","investor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_sibling_code_uq" ON "regions" USING btree ("tenant_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),"code");--> statement-breakpoint
CREATE INDEX "regions_parent_idx" ON "regions" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investors_tenant_code_uq" ON "investors" USING btree ("tenant_id","code");
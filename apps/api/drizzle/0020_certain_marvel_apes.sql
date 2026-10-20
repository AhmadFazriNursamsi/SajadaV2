CREATE TYPE "public"."central_move_type" AS ENUM('opening', 'receipt', 'shipment', 'shipment_cancel');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('in_transit', 'received', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'central_admin' BEFORE 'accountant';--> statement-breakpoint
CREATE TABLE "central_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "central_move_type" NOT NULL,
	"qty" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"ref_no" text,
	"note" text,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "central_stock" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"physical" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "central_stock_tenant_id_product_id_pk" PRIMARY KEY("tenant_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "shipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"no" text NOT NULL,
	"depot_id" uuid NOT NULL,
	"status" "shipment_status" DEFAULT 'in_transit' NOT NULL,
	"note" text,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"received_by_name" text,
	"receive_note" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_name" text,
	"cancel_reason" text
);
--> statement-breakpoint
ALTER TABLE "central_movements" ADD CONSTRAINT "central_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_movements" ADD CONSTRAINT "central_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_stock" ADD CONSTRAINT "central_stock_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_stock" ADD CONSTRAINT "central_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "central_movements_card_idx" ON "central_movements" USING btree ("tenant_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "shipment_lines_idx" ON "shipment_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_tenant_no_uq" ON "shipments" USING btree ("tenant_id","no");--> statement-breakpoint
CREATE INDEX "shipments_depot_idx" ON "shipments" USING btree ("depot_id","status");
--> statement-breakpoint
-- Pembersihan sisa rancangan awal "platform admin" (ada di basis data pengembangan; tidak ada di basis data baru).
DROP TABLE IF EXISTS "platform_audit";--> statement-breakpoint
DROP TABLE IF EXISTS "platform_settings";--> statement-breakpoint
DROP TABLE IF EXISTS "platform_admins";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "active";
--> statement-breakpoint
-- "Dalam perjalanan" lama tidak punya dokumen kiriman sehingga tidak bisa diterima lagi; kiriman kini lewat dokumen pusat → depot.
UPDATE "depot_stock" SET "in_transit" = 0 WHERE "in_transit" > 0;

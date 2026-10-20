CREATE TYPE "public"."stock_count_status" AS ENUM('draft', 'submitted', 'approved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_move_type" AS ENUM('opening', 'receipt', 'po_receipt', 'shipment', 'return', 'transfer_in', 'opname');--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"system_qty" integer NOT NULL,
	"counted_qty" integer,
	"reason" text,
	"note" text,
	"unit_cost" bigint DEFAULT 0 NOT NULL,
	"posted_delta" integer
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"no" text NOT NULL,
	"status" "stock_count_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by_id" uuid,
	"submitted_by_name" text,
	"submitted_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"return_note" text,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "stock_move_type" NOT NULL,
	"qty" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"ref_no" text,
	"note" text,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_uq" ON "stock_count_lines" USING btree ("count_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_tenant_no_uq" ON "stock_counts" USING btree ("tenant_id","no");--> statement-breakpoint
CREATE INDEX "stock_counts_depot_idx" ON "stock_counts" USING btree ("depot_id","status");--> statement-breakpoint
CREATE INDEX "stock_movements_card_idx" ON "stock_movements" USING btree ("depot_id","product_id","created_at");--> statement-breakpoint
INSERT INTO "stock_movements" ("tenant_id", "depot_id", "product_id", "type", "qty", "balance_after", "ref_no", "actor_name") SELECT d."tenant_id", s."depot_id", s."product_id", 'opening', s."physical", s."physical", 'Saldo awal (sebelum kartu stok)', 'Sistem' FROM "depot_stock" s JOIN "depots" d ON d."id" = s."depot_id" WHERE s."physical" <> 0;

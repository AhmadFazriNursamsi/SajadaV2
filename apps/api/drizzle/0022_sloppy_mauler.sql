CREATE TYPE "public"."stock_request_status" AS ENUM('pending', 'sent', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "stock_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"qty_sent" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"no" text NOT NULL,
	"depot_id" uuid NOT NULL,
	"status" "stock_request_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_name" text,
	"decision_note" text,
	"shipment_id" uuid
);
--> statement-breakpoint
ALTER TABLE "stock_request_lines" ADD CONSTRAINT "stock_request_lines_request_id_stock_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."stock_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request_lines" ADD CONSTRAINT "stock_request_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_request_lines_idx" ON "stock_request_lines" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_requests_tenant_no_uq" ON "stock_requests" USING btree ("tenant_id","no");--> statement-breakpoint
CREATE INDEX "stock_requests_depot_idx" ON "stock_requests" USING btree ("depot_id","status");
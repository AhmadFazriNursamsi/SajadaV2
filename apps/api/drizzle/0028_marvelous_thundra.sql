CREATE TABLE "order_report_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_ordered" integer NOT NULL,
	"qty_received" integer NOT NULL,
	"issue" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "order_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"group_no" text NOT NULL,
	"depot_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_name" text,
	"resolution" text
);
--> statement-breakpoint
ALTER TABLE "order_report_lines" ADD CONSTRAINT "order_report_lines_report_id_order_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."order_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_report_lines" ADD CONSTRAINT "order_report_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reports" ADD CONSTRAINT "order_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reports" ADD CONSTRAINT "order_reports_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reports" ADD CONSTRAINT "order_reports_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_report_lines_idx" ON "order_report_lines" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "order_reports_group_idx" ON "order_reports" USING btree ("tenant_id","group_id","created_at");--> statement-breakpoint
CREATE INDEX "order_reports_depot_idx" ON "order_reports" USING btree ("depot_id","status");
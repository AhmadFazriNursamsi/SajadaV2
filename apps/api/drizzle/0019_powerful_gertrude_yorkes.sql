ALTER TABLE "stock_counts" ADD COLUMN "needs_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD COLUMN "exceed_reason" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "opname_tolerance_pct" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "opname_tolerance_value" bigint DEFAULT 500000 NOT NULL;
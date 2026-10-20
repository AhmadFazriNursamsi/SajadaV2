ALTER TABLE "stock_request_lines" ADD COLUMN "unit_price" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "invoice_no" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "npwp" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "signatory" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "signatory_title" text;
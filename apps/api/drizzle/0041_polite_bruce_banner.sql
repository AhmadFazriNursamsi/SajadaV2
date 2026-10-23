CREATE TABLE "order_report_photos" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_reports" ADD COLUMN "verify_status" text DEFAULT 'valid' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_reports" ADD COLUMN "verify_note" text;--> statement-breakpoint
ALTER TABLE "order_reports" ADD COLUMN "verified_by_name" text;--> statement-breakpoint
ALTER TABLE "order_reports" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_report_photos" ADD CONSTRAINT "order_report_photos_report_id_order_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."order_reports"("id") ON DELETE cascade ON UPDATE no action;
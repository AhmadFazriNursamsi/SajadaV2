ALTER TABLE "shipment_lines" ADD COLUMN "qty_received" integer;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "issue" text;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "issue_note" text;
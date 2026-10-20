ALTER TYPE "public"."commission_status" ADD VALUE 'reversed';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_reversed_from" "commission_status";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_request_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "returned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "returned_by" text;--> statement-breakpoint
UPDATE "orders" SET "received_at" = "created_at" WHERE "received" = true;

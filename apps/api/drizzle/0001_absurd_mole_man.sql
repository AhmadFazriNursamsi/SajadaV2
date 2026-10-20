DROP TABLE "gold_allocations" CASCADE;--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "bank_status";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "bank_last4";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "bank_ref";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "bank_submitted_by";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "gold_percent";--> statement-breakpoint
DROP TYPE "public"."bank_status";
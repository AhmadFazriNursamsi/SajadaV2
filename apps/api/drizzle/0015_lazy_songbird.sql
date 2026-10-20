ALTER TABLE "orders" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_phone" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_chk" CHECK ("orders"."buyer_id" is not null or "orders"."customer_name" is not null);
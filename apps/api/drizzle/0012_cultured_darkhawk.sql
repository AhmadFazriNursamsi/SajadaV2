CREATE TABLE "depot_stock" (
	"depot_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"physical" integer DEFAULT 0 NOT NULL,
	"in_transit" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "depot_stock_depot_id_product_id_pk" PRIMARY KEY("depot_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "depot_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "depot_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "depot_id" uuid;--> statement-breakpoint
ALTER TABLE "depot_stock" ADD CONSTRAINT "depot_stock_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_stock" ADD CONSTRAINT "depot_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depots" ADD CONSTRAINT "depots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "depots_tenant_name_uq" ON "depots" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Konversi data: setiap tenant mendapat satu depot dari nama depot lama; stok, pesanan, PO, dan petugas dipindah ke depot itu.
INSERT INTO "depots" ("tenant_id", "name") SELECT "id", "depot_name" FROM "tenants";--> statement-breakpoint
INSERT INTO "depot_stock" ("depot_id", "product_id", "physical", "in_transit") SELECT d."id", p."id", p."physical", p."in_transit" FROM "products" p JOIN "depots" d ON d."tenant_id" = p."tenant_id";--> statement-breakpoint
UPDATE "orders" o SET "depot_id" = d."id", "approved_at" = o."created_at", "approved_by" = 'Migrasi' FROM "depots" d WHERE d."tenant_id" = o."tenant_id";--> statement-breakpoint
UPDATE "purchase_orders" po SET "depot_id" = d."id" FROM "depots" d WHERE d."tenant_id" = po."tenant_id";--> statement-breakpoint
UPDATE "users" u SET "depot_id" = d."id" FROM "depots" d WHERE d."tenant_id" = u."tenant_id" AND u."role" = 'staff';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "depot_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ALTER COLUMN "depot_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "physical";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "in_transit";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "depot_name";
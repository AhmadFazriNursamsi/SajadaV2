ALTER TABLE "orders" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "group_no" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "line_no" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Pesanan lama: baris yang dibuat sekaligus (satu checkout: depot, penjual, pembeli, dan waktu sama) dijadikan satu pesanan.
WITH g AS (
  SELECT id,
    (first_value(id) OVER w) AS gid,
    (first_value("no") OVER w) AS gno,
    (row_number() OVER w)::smallint AS ln
  FROM "orders"
  WINDOW w AS (PARTITION BY tenant_id, depot_id, seller_id, buyer_id, customer_name, created_at ORDER BY "no")
)
UPDATE "orders" o SET group_id = g.gid, group_no = g.gno, line_no = g.ln FROM g WHERE g.id = o.id;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "group_no" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "orders_group_idx" ON "orders" USING btree ("tenant_id","group_id");

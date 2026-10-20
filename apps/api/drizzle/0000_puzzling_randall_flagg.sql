CREATE TYPE "public"."bank_status" AS ENUM('none', 'pending', 'verified');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('pending', 'approved', 'paid');--> statement-breakpoint
CREATE TYPE "public"."pay_status" AS ENUM('unpaid', 'balance', 'cash');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('draft', 'approved', 'partial', 'done');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'settled');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('tenant_admin', 'accountant', 'staff', 'member');--> statement-breakpoint
CREATE TABLE "ap_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payable_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counters_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "gold_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"percent" smallint NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"rest" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_allocations_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
CREATE TABLE "investors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"share_percent" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"family_code" text,
	"member_no" text,
	"placed" boolean DEFAULT false NOT NULL,
	"bank_status" "bank_status" DEFAULT 'none' NOT NULL,
	"bank_last4" text,
	"bank_ref" text,
	"bank_submitted_by" uuid,
	"funded" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"remaining" bigint DEFAULT 0 NOT NULL,
	"cumulative" bigint DEFAULT 0 NOT NULL,
	"gold_percent" smallint DEFAULT 0 NOT NULL,
	"sponsor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"no" text NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"uplines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pay" "pay_status" DEFAULT 'unpaid' NOT NULL,
	"shipped" boolean DEFAULT false NOT NULL,
	"received" boolean DEFAULT false NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"delivery_ref" text,
	"proof_ref" text,
	"receiver_name" text,
	"commission" "commission_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"no" text NOT NULL,
	"supplier_id" uuid,
	"po_id" uuid,
	"due_date" date NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"paid" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"physical" integer DEFAULT 0 NOT NULL,
	"in_transit" integer DEFAULT 0 NOT NULL,
	"safety" integer DEFAULT 0 NOT NULL,
	"target" integer DEFAULT 0 NOT NULL,
	"moq" integer DEFAULT 1 NOT NULL,
	"multiple" integer DEFAULT 1 NOT NULL,
	"auto_replenish" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"buy_price" bigint DEFAULT 0 NOT NULL,
	"sell_price" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profit_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"no" text NOT NULL,
	"member_id" uuid NOT NULL,
	"period" text NOT NULL,
	"ref" text NOT NULL,
	"revenue" bigint DEFAULT 0 NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"profit" bigint DEFAULT 0 NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"member_share" bigint DEFAULT 0 NOT NULL,
	"investor_share" bigint DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"no" text NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_id" uuid,
	"qty" integer NOT NULL,
	"accepted" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"status" "po_status" DEFAULT 'draft' NOT NULL,
	"promised_date" date,
	"invoiced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"province_name" text NOT NULL,
	"province_code" text NOT NULL,
	"regency_name" text NOT NULL,
	"regency_code" text NOT NULL,
	"district_code" text DEFAULT '01' NOT NULL,
	"depot_name" text NOT NULL,
	"cash" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_payable_id_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."payables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_allocations" ADD CONSTRAINT "gold_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_allocations" ADD CONSTRAINT "gold_allocations_report_id_profit_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."profit_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_allocations" ADD CONSTRAINT "gold_allocations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_members_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_members_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_reports" ADD CONSTRAINT "profit_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_reports" ADD CONSTRAINT "profit_reports_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ap_payments_tenant_ref_uq" ON "ap_payments" USING btree ("tenant_id","ref");--> statement-breakpoint
CREATE INDEX "audit_tenant_time_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "members_tenant_no_uq" ON "members" USING btree ("tenant_id","member_no");--> statement-breakpoint
CREATE INDEX "members_tenant_idx" ON "members" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_no_uq" ON "orders" USING btree ("tenant_id","no");--> statement-breakpoint
CREATE INDEX "orders_product_idx" ON "orders" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payables_tenant_no_uq" ON "payables" USING btree ("tenant_id","no");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_sku_uq" ON "products" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_tenant_no_uq" ON "profit_reports" USING btree ("tenant_id","no");--> statement-breakpoint
CREATE UNIQUE INDEX "po_tenant_no_uq" ON "purchase_orders" USING btree ("tenant_id","no");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_uq" ON "users" USING btree ("tenant_id","email");
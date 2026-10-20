CREATE TABLE "installment_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"day" date NOT NULL,
	"seq" integer NOT NULL,
	"due" bigint NOT NULL,
	"paid" bigint NOT NULL,
	"arrears_after" bigint NOT NULL,
	"ref_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "installment_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "installment_arrears" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "installment_entries" ADD CONSTRAINT "installment_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_entries" ADD CONSTRAINT "installment_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "installment_member_day_uq" ON "installment_entries" USING btree ("member_id","day");--> statement-breakpoint
CREATE INDEX "installment_tenant_idx" ON "installment_entries" USING btree ("tenant_id","created_at");
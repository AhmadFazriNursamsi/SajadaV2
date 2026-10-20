CREATE TABLE "master_fetches" (
	"key" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_regions" (
	"level" "region_level" NOT NULL,
	"code" text NOT NULL,
	"parent_code" text,
	"name" text NOT NULL,
	CONSTRAINT "master_regions_level_code_pk" PRIMARY KEY("level","code")
);
--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "source_code" text;--> statement-breakpoint
CREATE INDEX "master_regions_parent_idx" ON "master_regions" USING btree ("level","parent_code");
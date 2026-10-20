CREATE TABLE "master_regions" (
	"level" "region_level" NOT NULL,
	"code" text NOT NULL,
	"parent_code" text,
	"name" text NOT NULL,
	"local_code" text NOT NULL,
	CONSTRAINT "master_regions_level_code_pk" PRIMARY KEY("level","code")
);
--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "source_code" text;--> statement-breakpoint
CREATE INDEX "master_regions_parent_idx" ON "master_regions" USING btree ("level","parent_code");
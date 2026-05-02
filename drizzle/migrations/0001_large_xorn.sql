CREATE TABLE IF NOT EXISTS "admin_config" (
	"admin_user_id" uuid PRIMARY KEY NOT NULL,
	"pin_hash" text,
	"pin_attempts" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"last_pin_set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fee_config" (
	"fee_type" text PRIMARY KEY NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "speed_oracle_latest" (
	"asset" text PRIMARY KEY NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "speed_oracle_ticks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"source" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_config" ADD CONSTRAINT "admin_config_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fee_config" ADD CONSTRAINT "fee_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "speed_oracle_latest" ADD CONSTRAINT "speed_oracle_latest_asset_speed_assets_id_fk" FOREIGN KEY ("asset") REFERENCES "public"."speed_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "speed_oracle_ticks" ADD CONSTRAINT "speed_oracle_ticks_asset_speed_assets_id_fk" FOREIGN KEY ("asset") REFERENCES "public"."speed_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "speed_oracle_ticks_asset_ts_idx" ON "speed_oracle_ticks" USING btree ("asset","ts");
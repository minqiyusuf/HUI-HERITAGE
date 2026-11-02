-- Extend the profile table created by 202609170001.  The previous migration
-- repeated CREATE TABLE, which stopped upgrades before this feature was ready.
ALTER TABLE "personal_collection_profiles"
  ADD COLUMN IF NOT EXISTS "public_collector_name" TEXT,
  ADD COLUMN IF NOT EXISTS "themes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "primary_eras" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "primary_region" TEXT,
  ADD COLUMN IF NOT EXISTS "collecting_since_year" INTEGER,
  ADD COLUMN IF NOT EXISTS "origin_story" TEXT,
  ADD COLUMN IF NOT EXISTS "collaboration_interests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "accepts_messages" BOOLEAN;

CREATE UNIQUE INDEX IF NOT EXISTS "personal_collection_profiles_cover_media_id_key"
  ON "personal_collection_profiles"("cover_media_id");

DO $$ BEGIN
  ALTER TABLE "personal_collection_profiles"
    ADD CONSTRAINT "personal_collection_profiles_cover_media_id_fkey"
    FOREIGN KEY ("cover_media_id") REFERENCES "media_assets"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

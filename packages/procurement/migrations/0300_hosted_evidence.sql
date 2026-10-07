-- Private proof bytes shared by independently deployed API and worker services.
-- Nullable preserves the local filesystem storage mode and existing records.
ALTER TABLE gob_evidence_files ADD COLUMN IF NOT EXISTS raw_bytes bytea
  CHECK (raw_bytes IS NULL OR octet_length(raw_bytes) BETWEEN 1 AND 1048576);

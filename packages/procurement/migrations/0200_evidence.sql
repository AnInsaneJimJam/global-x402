-- Track B: private recipients, uploaded evidence files and unique per-order nonces.
-- Recipient rows are immutable once written; they are part of the accepted delivery terms.
-- Refs are per buyer, so another buyer cannot squat a ref name.
CREATE TABLE IF NOT EXISTS gob_recipients (
  buyer_id text NOT NULL,
  ref text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (buyer_id, ref)
);
-- Raw .eml bytes live in private file storage; this row authorises their use for one assignment.
CREATE TABLE IF NOT EXISTS gob_evidence_files (
  order_id text NOT NULL,
  sha256 text NOT NULL,
  filler_id text NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, sha256)
);
CREATE UNIQUE INDEX IF NOT EXISTS gob_orders_nonce_idx ON gob_orders ((data->>'orderNonce'))
  WHERE data->>'orderNonce' IS NOT NULL;

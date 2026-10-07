CREATE TABLE IF NOT EXISTS gob_outbox (
  id text PRIMARY KEY,
  kind text NOT NULL,
  order_id text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS gob_outbox_due_idx ON gob_outbox (next_at, lease_until);

CREATE TABLE IF NOT EXISTS gob_orders (
  id text PRIMARY KEY,
  buyer_id text NOT NULL,
  client_order_id text NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (buyer_id, client_order_id)
);
CREATE TABLE IF NOT EXISTS gob_plans (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS gob_operations (
  actor_id text NOT NULL,
  operation_id text NOT NULL,
  effect_hash text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (actor_id, operation_id)
);
CREATE TABLE IF NOT EXISTS gob_transport_keys (
  actor_id text NOT NULL,
  transport_key text NOT NULL,
  operation_id text NOT NULL,
  effect_hash text NOT NULL,
  PRIMARY KEY (actor_id, transport_key)
);
CREATE TABLE IF NOT EXISTS gob_purchase_bindings (
  actor_id text NOT NULL,
  purchase_operation_id text NOT NULL,
  order_id text NOT NULL,
  PRIMARY KEY (actor_id, purchase_operation_id)
);
-- Global merchant-order uniqueness prevents reuse across assignments.
CREATE TABLE IF NOT EXISTS gob_evidence_bindings (
  merchant_id text NOT NULL,
  merchant_order_id text NOT NULL,
  order_id text NOT NULL,
  PRIMARY KEY (merchant_id, merchant_order_id)
);

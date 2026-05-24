-- migrate_019: Display IDs and internal counters for quotes and sales orders

-- Counter table: one row per entity type, monotonically incrementing
CREATE TABLE IF NOT EXISTS id_counter (
  type     TEXT PRIMARY KEY,
  next_val INTEGER NOT NULL DEFAULT 1
);

INSERT INTO id_counter (type, next_val) VALUES
  ('quote',       1),
  ('sales_order', 1)
ON CONFLICT (type) DO NOTHING;

-- Add customer-facing display_id and internal sequential counter to quote
ALTER TABLE quote
  ADD COLUMN IF NOT EXISTS display_id   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS internal_seq INTEGER;

-- Sales orders are quotes that have been confirmed/converted.
-- display_id carries the SO- prefix with the same 5-char suffix as the source quote.
CREATE TABLE IF NOT EXISTS sales_order (
  id           SERIAL PRIMARY KEY,
  display_id   TEXT NOT NULL UNIQUE,
  internal_seq INTEGER NOT NULL,
  quote_id     INTEGER REFERENCES quote(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'confirmed',
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_order_quote_id_idx ON sales_order (quote_id);
CREATE INDEX IF NOT EXISTS sales_order_created_at_idx ON sales_order (created_at);
CREATE INDEX IF NOT EXISTS quote_created_at_idx ON quote (created_at);

-- migrate_018: Quotes and surcharge configuration

CREATE TABLE IF NOT EXISTS surcharge_config (
  id           SERIAL PRIMARY KEY,
  purification TEXT NOT NULL UNIQUE,
  surcharge    NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO surcharge_config (purification, surcharge) VALUES
  ('Standard Desalt', 0),
  ('HPLC', 25),
  ('PAGE', 30),
  ('RNase-free HPLC', 30)
ON CONFLICT (purification) DO NOTHING;

CREATE TABLE IF NOT EXISTS quote (
  id           SERIAL PRIMARY KEY,
  order_id     UUID REFERENCES "order"(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  discount_abs NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quote_line (
  id            SERIAL PRIMARY KEY,
  quote_id      INTEGER NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  order_line_id UUID REFERENCES order_line(id) ON DELETE SET NULL,
  sequence_id   UUID REFERENCES sequence(id) ON DELETE SET NULL,
  oligo_name    TEXT,
  sequence_text TEXT NOT NULL,
  purification  TEXT NOT NULL DEFAULT 'Standard Desalt',
  scale_nmol    INTEGER,
  included      BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

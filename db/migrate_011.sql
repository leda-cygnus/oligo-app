-- migrate_011: structured address fields on customer + researcher on order_line

-- Replace single address blob with structured fields (rename address -> street, add others)
ALTER TABLE customer RENAME COLUMN address TO street;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS building_name TEXT;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS lab          TEXT;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS city         TEXT;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS zip          TEXT;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS phone        TEXT;

-- Per-oligo researcher attribution
ALTER TABLE order_line ADD COLUMN IF NOT EXISTS researcher TEXT;

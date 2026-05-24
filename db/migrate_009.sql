-- migrate_009: add address field to customer
ALTER TABLE customer ADD COLUMN IF NOT EXISTS address TEXT;

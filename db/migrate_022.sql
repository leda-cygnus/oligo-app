-- migrate_022: material_lot — add out_of_stock flag
--
-- Allows users to mark old lots as out of stock so they are hidden
-- from the default view without being deleted.

ALTER TABLE material_lot
  ADD COLUMN IF NOT EXISTS out_of_stock BOOLEAN NOT NULL DEFAULT FALSE;

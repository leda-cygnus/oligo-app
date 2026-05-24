-- migrate_015: CPG tracking per well position instead of per column

-- Step 1: add plate_position column (nullable)
ALTER TABLE synthesis_run_cpg ADD COLUMN IF NOT EXISTS plate_position TEXT;

-- Step 2: drop old PK (required before making column_number nullable)
ALTER TABLE synthesis_run_cpg DROP CONSTRAINT synthesis_run_cpg_pkey;

-- Step 3: make column_number nullable
ALTER TABLE synthesis_run_cpg ALTER COLUMN column_number DROP NOT NULL;

-- Step 4: expand column-level rows into per-well rows in a single INSERT.
--   Branch A: columns that have matching synthesis lines → one row per line.
--   Branch B: columns with no matching lines → one row per row letter (A-H).
--   UNION deduplicates the combined set before inserting.
INSERT INTO synthesis_run_cpg (run_id, plate_position, lot_number, material_lot_id)
  SELECT DISTINCT cpg.run_id, srl.plate_position, cpg.lot_number, cpg.material_lot_id
  FROM synthesis_run_cpg cpg
  JOIN synthesis_run_line srl
    ON srl.run_id = cpg.run_id
   AND SUBSTRING(srl.plate_position FROM 2)::int = cpg.column_number
  WHERE cpg.plate_position IS NULL
UNION
  SELECT cpg.run_id, r.letter || cpg.column_number::text, cpg.lot_number, cpg.material_lot_id
  FROM synthesis_run_cpg cpg
  CROSS JOIN (VALUES ('A'),('B'),('C'),('D'),('E'),('F'),('G'),('H')) AS r(letter)
  WHERE cpg.plate_position IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM synthesis_run_line srl
      WHERE srl.run_id = cpg.run_id
        AND SUBSTRING(srl.plate_position FROM 2)::int = cpg.column_number
    );

-- Step 5: remove old column-level rows
DELETE FROM synthesis_run_cpg WHERE plate_position IS NULL;

-- Step 6: finalize new schema
ALTER TABLE synthesis_run_cpg DROP COLUMN column_number;
ALTER TABLE synthesis_run_cpg ALTER COLUMN plate_position SET NOT NULL;
ALTER TABLE synthesis_run_cpg ADD PRIMARY KEY (run_id, plate_position);

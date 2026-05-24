-- migrate_012: molecular weight on sequence table

ALTER TABLE sequence ADD COLUMN IF NOT EXISTS mol_weight NUMERIC(10,2);

-- Backfill existing sequences that have parsed tokens
UPDATE sequence
SET mol_weight = (
  CASE
    WHEN tokens->>'oligo_type' = 'RNA' THEN
      length(regexp_replace(tokens->>'bases', '[^A]', '', 'g')) * 329.21 +
      length(regexp_replace(tokens->>'bases', '[^C]', '', 'g')) * 305.18 +
      length(regexp_replace(tokens->>'bases', '[^G]', '', 'g')) * 345.21 +
      length(regexp_replace(tokens->>'bases', '[^U]', '', 'g')) * 306.17 - 61.96
    ELSE
      length(regexp_replace(tokens->>'bases', '[^A]', '', 'g')) * 313.21 +
      length(regexp_replace(tokens->>'bases', '[^C]', '', 'g')) * 289.18 +
      length(regexp_replace(tokens->>'bases', '[^G]', '', 'g')) * 329.21 +
      length(regexp_replace(tokens->>'bases', '[^T]', '', 'g')) * 304.19 - 61.96
  END
)
WHERE tokens IS NOT NULL AND tokens->>'bases' IS NOT NULL;

-- Rebuild view to include mol_weight
DROP VIEW IF EXISTS v_annotated_sequence;
CREATE VIEW v_annotated_sequence AS
SELECT
  s.id                              AS sequence_id,
  s.raw_idt                         AS annotated_sequence,
  s.tokens->>'oligo_type'           AS oligo_type,
  char_length(s.tokens->>'bases')   AS length_nt,
  s.mol_weight
FROM sequence s;

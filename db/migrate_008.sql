-- migrate_008: define v_annotated_sequence view
-- Provides per-sequence annotated notation, oligo type, and length
-- derived from the raw_idt and tokens columns on the sequence table.
DROP VIEW IF EXISTS v_annotated_sequence;
CREATE VIEW v_annotated_sequence AS
SELECT
  s.id                              AS sequence_id,
  s.raw_idt                         AS annotated_sequence,
  s.tokens->>'oligo_type'           AS oligo_type,
  char_length(s.tokens->>'bases')   AS length_nt
FROM sequence s;

-- migrate_023: allow multiple sequence records with the same base sequence.
-- Each imported oligo gets its own row; the UUID is the only uniqueness key.
-- The base-sequence checksum was used for deduplication but that prevents storing
-- e.g. /5CY5/ACGT and /5DY751/ACGT as separate entries in the same order.

DROP INDEX IF EXISTS idx_sequence_checksum;

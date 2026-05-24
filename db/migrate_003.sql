-- migrate_003: extend order_status enum, add run detail endpoint support
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'in_progress';

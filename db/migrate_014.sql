-- migrate_014: revert stale in_progress order statuses where no started run exists

UPDATE "order" SET status = 'received'
WHERE status = 'in_progress'
AND id NOT IN (
  SELECT DISTINCT ol.order_id
  FROM synthesis_run_line srl
  JOIN order_line ol ON ol.id = srl.order_line_id
  JOIN synthesis_run sr ON sr.id = srl.run_id
  WHERE sr.started_at IS NOT NULL
);

UPDATE keys SET active = TRUE WHERE key IN (
    SELECT key FROM keys JOIN active_rules ON key ~ keys WHERE (after <= CURRENT_TIMESTAMP) AND NOT active
);

UPDATE keys SET visible = TRUE WHERE key IN (
    SELECT key FROM keys JOIN visible_rules ON key ~ keys WHERE (after <= CURRENT_TIMESTAMP) AND NOT visible
);

DELETE FROM precompute_queue AS pq
USING current_computed AS cc
WHERE pq.username = cc.username AND pq.key = cc.key
;

DELETE FROM precompute_queue AS pq_in
USING computations, precompute_queue AS pq_out
WHERE pq_in.key ? inputs AND output = pq_out.key
;

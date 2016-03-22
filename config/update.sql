UPDATE keys SET active = TRUE WHERE key IN (
    SELECT key FROM keys JOIN active_rules ON key ~ keys WHERE (after <= CURRENT_TIMESTAMP) AND NOT active
);

UPDATE keys SET visible = TRUE WHERE key IN (
    SELECT key FROM keys JOIN visible_rules ON key ~ keys WHERE (after <= CURRENT_TIMESTAMP) AND NOT visible
);

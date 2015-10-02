-- grades
SELECT user, key, parent,
       ifnull(ts, comp_ts) AS ts, ifnull(type, comp_type) AS type, ifnull(value, comp_value) AS value,
       CASE WHEN ts IS NULL THEN computed ELSE NULL END AS computed,
       leaf, active, visible, due, compute, children FROM
(
    -- DISTINCT user FROM current_data
    SELECT $user AS user
)
JOIN
-- NATURAL JOIN active
active
NATURAL LEFT JOIN
current_data
NATURAL LEFT JOIN
(
    SELECT user, key, ts AS comp_ts, type AS comp_type, value AS comp_value, 1 AS computed FROM current_computed
    WHERE user = $user AND key IN (SELECT input FROM dataflow WHERE output = $key)
)
NATURAL LEFT JOIN
keyinfo
WHERE user = $user AND key IN (SELECT input FROM dataflow WHERE output = $key)
ORDER BY parent, rank, key

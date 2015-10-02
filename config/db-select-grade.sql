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
leaves
NATURAL LEFT JOIN
current_data
NATURAL LEFT JOIN
(
    SELECT user, key, ts AS comp_ts, type AS comp_type, value AS comp_value, 1 AS computed FROM current_computed
    WHERE user = $user AND key = $key
)
NATURAL LEFT JOIN
(
    -- keyinfo
    SELECT * FROM
    keys
    NATURAL LEFT JOIN
    (SELECT key, 1 AS leaf FROM leaves WHERE key = $key)
    NATURAL LEFT JOIN
    (SELECT key, 1 AS active FROM active WHERE key = $key)
    NATURAL LEFT JOIN
    (SELECT key, 1 AS visible FROM visible WHERE key = $key)
    NATURAL LEFT JOIN
    ranks
    NATURAL LEFT JOIN
    deadlines
    NATURAL LEFT JOIN
    (SELECT DISTINCT output AS key, 1 AS compute FROM dataflow WHERE output = $key)
    NATURAL LEFT JOIN
    (SELECT DISTINCT parent AS key, 1 AS children FROM keys WHERE parent = $key)
    WHERE key = $key
)
WHERE user = $user AND key = $key

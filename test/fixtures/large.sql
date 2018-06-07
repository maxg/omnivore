INSERT INTO visible_rules VALUES ('test.*', CURRENT_TIMESTAMP - INTERVAL '1 day');
INSERT INTO active_rules VALUES ('test.*', CURRENT_TIMESTAMP - INTERVAL '1 day');

INSERT INTO raw_data
SELECT username, key::LTREE, ts, ('"'||md5(random()::text)||'"')::JSONB, 'tester' FROM
(SELECT 'user'||generate_series(1, 200) AS username) AS username
CROSS JOIN
(SELECT 'test.vals.val'||generate_series(1, 32)||'.text' AS key) AS key
CROSS JOIN
(SELECT CURRENT_TIMESTAMP + (generate_series(-10, -1)*6||' seconds')::INTERVAL AS ts) AS ts
;

INSERT INTO computation_rules VALUES
('test.vals.*{1}', 'zero', '{ "text" }', 'text => text.startsWith("0")'),
('test', 'zero_fraction', '{ "vals.*{1}.zero" }', 'zeros => [ sum(zeros), zeros.length ]')
;

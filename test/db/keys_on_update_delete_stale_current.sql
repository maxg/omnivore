INSERT INTO raw_data VALUES ('alice', 'test.alpha', t(), '0', 'tester');
INSERT INTO current_data VALUES ('alice', 'test.alpha', t(), '0', NULL, 'tester');

SELECT * INTO STRICT result FROM all_data;
PERFORM assert(result.username = 'alice', result::TEXT);
PERFORM assert(result.key = 'test.alpha', result::TEXT);
PERFORM assert(result.value = '0', result::TEXT);

INSERT INTO penalties VALUES ('unknown', 'unknown', 'unknown')
RETURNING penalty_id INTO result;

UPDATE keys SET (deadline, penalty_id) = (t(), result.penalty_id);

SELECT * INTO result FROM current_data;
PERFORM assert(NOT FOUND, result::TEXT);

SELECT count(*) AS count INTO STRICT result FROM all_data;
PERFORM assert(result.count = 1, result::TEXT);

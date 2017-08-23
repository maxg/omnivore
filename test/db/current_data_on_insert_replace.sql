INSERT INTO raw_data VALUES ('alice', 'test.alpha', t(), '0', 'tester');
INSERT INTO current_data VALUES ('alice', 'test.alpha', t(), '0', NULL, 'tester');

SELECT * INTO STRICT result FROM all_data;
PERFORM assert(result.username = 'alice', result::TEXT);
PERFORM assert(result.key = 'test.alpha', result::TEXT);
PERFORM assert(result.value = '0', result::TEXT);

INSERT INTO current_data VALUES ('alice', 'test.alpha', t(), '0', NULL, 'tester');

SELECT * INTO STRICT result FROM current_data;
PERFORM assert(result.value = '0', result::TEXT);

SELECT * INTO STRICT result FROM all_data;
PERFORM assert(result.value = '0', result::TEXT);

INSERT INTO current_data VALUES ('alice', 'test.alpha', t(), '42', NULL, 'tester');

SELECT * INTO STRICT result FROM current_data;
PERFORM assert(result.value = '42', result::TEXT);

SELECT count(*) AS count INTO STRICT result FROM all_data;
PERFORM assert(result.count = 2, result::TEXT);

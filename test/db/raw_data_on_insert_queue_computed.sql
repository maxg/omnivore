INSERT INTO keys VALUES ('test.alpha');
UPDATE keys SET active = TRUE;

INSERT INTO computations VALUES ('test', 'test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');

INSERT INTO raw_data VALUES ('alice', 'test.alpha', t(), '7', 'tester');

SELECT * INTO result FROM precompute_queue WHERE username = 'alice' AND key = 'test.beta';
PERFORM assert(FOUND, result::TEXT);

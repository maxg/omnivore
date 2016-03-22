INSERT INTO keys VALUES ('test.alpha');
UPDATE keys SET active = TRUE;

INSERT INTO computations VALUES ('test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');
INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42', NULL);

SELECT * INTO STRICT result FROM current_computed;
PERFORM assert(FOUND);

INSERT INTO raw_data VALUES ('alice', 'test.alpha', t(), '0', 'tester');
INSERT INTO current_data VALUES ('alice', 'test.alpha', t(), '0', NULL, 'tester');

SELECT * INTO result FROM current_computed;
PERFORM assert(NOT FOUND, result::TEXT);

INSERT INTO keys VALUES ('test.alpha');
UPDATE keys SET active = TRUE;

INSERT INTO raw_data VALUES ('alice', 'test.alpha', t(), '0', 'tester');
INSERT INTO current_data VALUES ('alice', 'test.alpha', t(), '0', NULL, 'tester');
INSERT INTO raw_data VALUES ('bob', 'test.alpha', t(), '0', 'tester');
INSERT INTO current_data VALUES ('bob', 'test.alpha', t(), '0', NULL, 'tester');

INSERT INTO computations VALUES ('test', 'test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');
INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');
INSERT INTO current_computed VALUES ('bob', 'test.beta', t(), '7');

DELETE FROM current_data WHERE username = 'alice';

SELECT * INTO result FROM current_computed WHERE username = 'alice';
PERFORM assert(NOT FOUND, result::TEXT);

SELECT * INTO STRICT result FROM current_computed WHERE username = 'bob';
PERFORM assert(FOUND);

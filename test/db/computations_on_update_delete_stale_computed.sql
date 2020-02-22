INSERT INTO computations VALUES ('test', 'test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');
INSERT INTO current_computed VALUES ('alice', 'test.alpha', t(), '7');
INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');

SELECT * INTO STRICT result FROM current_computed WHERE key = 'test.beta';
PERFORM assert(FOUND);

UPDATE computations SET compute = '() -> 0';

SELECT * INTO result FROM current_computed WHERE key = 'test.beta';
PERFORM assert(NOT FOUND, result::TEXT);

SELECT * INTO STRICT result FROM current_computed WHERE key = 'test.alpha';
PERFORM assert(FOUND);

INSERT INTO keys VALUES ('test.alpha');
UPDATE keys SET active = TRUE;

INSERT INTO computations VALUES ('test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');
INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');

SELECT * INTO STRICT result FROM current_computed;
PERFORM assert(FOUND);

INSERT INTO current_computed VALUES ('alice', 'test.alpha', t(), '7');

SELECT * INTO STRICT result FROM current_computed WHERE key = 'test.alpha';
PERFORM assert(FOUND);

SELECT * INTO result FROM current_computed WHERE key = 'test.beta';
PERFORM assert(NOT FOUND, result::TEXT);

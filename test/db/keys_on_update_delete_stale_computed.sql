INSERT INTO keys VALUES ('test.alpha');

INSERT INTO computations VALUES ('test', 'test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');
INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');

SELECT * INTO STRICT result FROM current_computed;
PERFORM assert(FOUND);

UPDATE keys SET active = TRUE;

SELECT * INTO result FROM current_computed;
PERFORM assert(NOT FOUND, result::TEXT);

INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');

SELECT * INTO STRICT result FROM current_computed;
PERFORM assert(FOUND);

UPDATE keys SET active = FALSE;

SELECT * INTO result FROM current_computed;
PERFORM assert(NOT FOUND, result::TEXT);

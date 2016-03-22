INSERT INTO keys VALUES ('test.alpha');
UPDATE keys SET active = TRUE;

INSERT INTO computations VALUES ('test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');
INSERT INTO current_computed VALUES ('alice', 'test.alpha', t(), '7');
INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');

SELECT * INTO STRICT result FROM current_computed WHERE key = 'test.beta';
PERFORM assert(FOUND);

DELETE FROM current_computed WHERE key = 'test.alpha';

SELECT * INTO result FROM current_computed;
PERFORM assert(NOT FOUND, result::TEXT);

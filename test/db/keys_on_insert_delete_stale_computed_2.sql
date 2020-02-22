INSERT INTO active_rules VALUES ('test.a*', t_minus('1 hour'));

INSERT INTO keys VALUES ('test.alpha');

INSERT INTO computations VALUES ('test', 'test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');
INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');

SELECT * INTO STRICT result FROM current_computed;
PERFORM assert(FOUND);

INSERT INTO keys (key, active) VALUES ('test.another', FALSE);

SELECT * INTO result FROM current_computed;
PERFORM assert(NOT FOUND, result::TEXT);

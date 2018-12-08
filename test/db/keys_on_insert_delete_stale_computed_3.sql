INSERT INTO active_rules VALUES ('test.a*', t_minus('1 hour'));

INSERT INTO keys VALUES ('test.alpha');

INSERT INTO computations VALUES ('test.beta', ARRAY[LQUERY 'test.a*'], '(a) -> a');
INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');

SELECT * INTO STRICT result FROM current_computed;
PERFORM assert(FOUND);

INSERT INTO raw_data VALUES ('bob', 'test.another', t(), '7', 'tester');

SELECT * INTO result FROM current_computed;
PERFORM assert(NOT FOUND, result::TEXT);

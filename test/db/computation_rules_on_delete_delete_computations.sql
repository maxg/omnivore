INSERT INTO keys VALUES ('test.a.in1.a'), ('test.a.in2.a');

SELECT * INTO result FROM computations;
PERFORM assert(NOT FOUND, result::TEXT);

INSERT INTO computation_rules VALUES
    ('test.*', 'out1', '{"in1.*", "in2.*"}', 'unknown'),
    ('test', 'out2', '{"a.in1.*"}', 'unknown');

SELECT count(*) AS count INTO STRICT result FROM computations;
PERFORM assert(result.count = 2, result::TEXT);

DELETE FROM computation_rules WHERE output = 'out1';

SELECT * INTO STRICT result FROM computations;
PERFORM assert(result.output::TEXT = 'test.out2', result.output::TEXT);

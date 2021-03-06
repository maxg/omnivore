INSERT INTO keys VALUES ('test.a.in1.a'), ('test.a.in2.a');

SELECT * INTO result FROM computations;
PERFORM assert(NOT FOUND, result::TEXT);

-- generate duplicate key insertions
INSERT INTO computation_rules VALUES
    ('test.*', 'out1', '{"in1.*", "in2.*"}', 'unknown'),
    ('test', 'out2', '{"a.out1"}', 'unknown'); -- uses a.out1 as input

SELECT count(*) AS count INTO STRICT result FROM computations;
PERFORM assert(result.count = 2, result::TEXT);

SELECT * INTO STRICT result FROM computations WHERE output = 'test.a.out1';
PERFORM assert(result.inputs::TEXT[] = ARRAY[ 'test.a.in1.*', 'test.a.in2.*' ], result.inputs::TEXT);

SELECT * INTO STRICT result FROM computations WHERE output = 'test.out2';
PERFORM assert(result.inputs::TEXT[] = ARRAY[ 'test.a.out1' ], result.inputs::TEXT);

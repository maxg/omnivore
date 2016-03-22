INSERT INTO computation_rules VALUES
    ('test.*', 'out1', '{"in1.*", "in2.*"}', 'unknown'),
    ('test', 'out2', '{"a.in1.*"}', 'unknown');

SELECT * INTO result FROM computations;
PERFORM assert(NOT FOUND, result::TEXT);

INSERT INTO keys VALUES ('test.a.in1.a'), ('test.b');

-- TODO improve
SELECT count(*) AS count INTO STRICT result FROM computations;
PERFORM assert(result.count = 2, result::TEXT);

SELECT * INTO STRICT result FROM computations WHERE output = 'test.a.out1';
PERFORM assert(result.inputs::TEXT[] = ARRAY[ 'test.a.in1.*', 'test.a.in2.*' ]);

SELECT * INTO STRICT result FROM computations WHERE output = 'test.out2';
PERFORM assert(result.inputs::TEXT[] = ARRAY[ 'test.a.in1.*' ]);

INSERT INTO keys VALUES ('test.a.in2.a');

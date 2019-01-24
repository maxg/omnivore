INSERT INTO keys VALUES ('test.in1'), ('extra.in2');

SELECT * INTO result FROM computations;
PERFORM assert(NOT FOUND, result::TEXT);

-- generate duplicate key insertions
INSERT INTO computation_rules VALUES
    (NULL, 'test.out1', '{"test.in*", "extra.in*"}', 'unknown'),
    (NULL, 'out2', '{"test.in*", "extra.in*"}', 'unknown');

SELECT count(*) AS count INTO STRICT result FROM computations;
PERFORM assert(result.count = 2, result::TEXT);

SELECT * INTO STRICT result FROM computations WHERE output = 'test.out1';
PERFORM assert(result.inputs::TEXT[] = ARRAY[ 'test.in*', 'extra.in*' ], result.inputs::TEXT);

SELECT * INTO STRICT result FROM computations WHERE output = 'out2';
PERFORM assert(result.inputs::TEXT[] = ARRAY[ 'test.in*', 'extra.in*' ], result.inputs::TEXT);

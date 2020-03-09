SELECT * INTO result FROM computations;
PERFORM assert(NOT FOUND, result::TEXT);

INSERT INTO computation_rules VALUES
    (NULL, 'test.out1', '{}', 'unknown'),
    ('test', 'out2', '{}', 'unknown');

SELECT count(*) AS count INTO STRICT result FROM computations;
PERFORM assert(result.count = 2, result::TEXT);

SELECT * INTO STRICT result FROM computations WHERE output = 'test.out1';
PERFORM assert(FOUND, result::TEXT);

SELECT * INTO STRICT result FROM computations WHERE output = 'test.out2';
PERFORM assert(FOUND, result::TEXT);

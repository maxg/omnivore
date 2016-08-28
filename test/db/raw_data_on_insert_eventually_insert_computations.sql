INSERT INTO computation_rules VALUES
    ('test', 'out', '{in}', 'unknown');

SELECT * INTO result FROM keys;
PERFORM assert(NOT FOUND, result::TEXT);

SELECT * INTO result FROM computations;
PERFORM assert(NOT FOUND, result::TEXT);

INSERT INTO raw_data VALUES ('alice', 'test.in', t(), '0', 'tester');

SELECT * INTO STRICT result FROM computations;
PERFORM assert(result.inputs::TEXT[] = ARRAY[ 'test.in' ]);
PERFORM assert(result.output = 'test.out');

-- TODO improve
SELECT count(*) AS count INTO STRICT result FROM keys;
PERFORM assert(result.count = 2, result::TEXT);

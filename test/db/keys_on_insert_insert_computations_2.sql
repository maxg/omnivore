INSERT INTO computation_rules VALUES
    ('test', 'out1', '{"in1", "in2", "in3"}', 'unknown'),
    -- inputs in1 and out1, more total inputs
    ('test', 'out2', '{"in1", "in2", "in3", "out1"}', 'unknown'),
    -- inputs in1 and out1, fewer total inputs
    ('test', 'out3', '{"in1", "out1"}', 'unknown');

SELECT * INTO result FROM computations;
PERFORM assert(NOT FOUND, result::TEXT);

-- generate dupliate key insertions
INSERT INTO keys VALUES ('test.in1');

SELECT count(*) AS count INTO STRICT result FROM computations;
PERFORM assert(result.count = 3, result::TEXT);

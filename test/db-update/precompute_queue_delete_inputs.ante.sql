INSERT INTO computation_rules VALUES
    ('test', 'out1', '{"in1"}', 'unknown'),
    ('test', 'out2', '{"out1"}', 'unknown');

INSERT INTO current_computed VALUES ('alice', 'test.out1', t(), '42');
INSERT INTO current_computed VALUES ('alice', 'test.out2', t(), '42');

DELETE FROM current_computed;

SELECT count(*) AS count INTO STRICT result FROM precompute_queue;
PERFORM assert(result.count = 2, result::TEXT);

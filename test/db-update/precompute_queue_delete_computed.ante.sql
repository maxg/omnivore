INSERT INTO current_computed VALUES ('alice', 'test.in1', t(), '42');
INSERT INTO current_computed VALUES ('alice', 'test.in2', t(), '42');

DELETE FROM current_computed;

INSERT INTO current_computed VALUES ('alice', 'test.in1', t(), '42');

SELECT count(*) AS count INTO STRICT result FROM precompute_queue;
PERFORM assert(result.count = 2, result::TEXT);

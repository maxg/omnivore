INSERT INTO keys VALUES ('test.alpha');

INSERT INTO penalties VALUES ('unknown', 'unknown', 'unknown')
RETURNING penalty_id INTO result;
INSERT INTO deadline_rules VALUES ('test.a*', t(), result.penalty_id);

SELECT deadline, penalty_id INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.deadline IS NOT DISTINCT FROM t());
PERFORM assert(result.penalty_id IS NOT NULL);

UPDATE deadline_rules SET keys = 'test.b*';

SELECT deadline, penalty_id INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.deadline IS NULL);
PERFORM assert(result.penalty_id IS NULL);

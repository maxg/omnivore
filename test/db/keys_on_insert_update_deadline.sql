INSERT INTO penalties VALUES ('unknown', 'Unknown!', 'un => known');
INSERT INTO deadline_rules VALUES ('test.a*', t(), 'unknown');

INSERT INTO keys VALUES ('test.alpha'), ('test.beta');

SELECT deadline, penalty_id INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.deadline IS NOT DISTINCT FROM t());
PERFORM assert(result.penalty_id IS NOT DISTINCT FROM 'unknown');

SELECT deadline, penalty_id INTO STRICT result FROM keys WHERE key = 'test.beta';
PERFORM assert(result.deadline IS NULL);
PERFORM assert(result.penalty_id IS NULL);

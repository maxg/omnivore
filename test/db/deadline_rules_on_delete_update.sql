INSERT INTO keys VALUES ('test.alpha');

INSERT INTO penalties VALUES ('unknown', 'Unknown!', 'un => known');
INSERT INTO deadline_rules VALUES ('test.a*', t(), 'unknown');

SELECT deadline, penalty_id INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.deadline = t(), t()::TEXT || result::TEXT);
PERFORM assert(result.penalty_id = 'unknown');

DELETE FROM deadline_rules;

SELECT deadline, penalty_id INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.deadline = NULL);
PERFORM assert(result.penalty_id = NULL);

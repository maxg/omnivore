INSERT INTO keys VALUES ('test.alpha');

SELECT active INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(NOT result.active);

INSERT INTO active_rules VALUES ('test.a*', t_minus('1 hour'));

SELECT active INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.active);

UPDATE active_rules SET keys = 'test.b*';

SELECT active INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(NOT result.active);

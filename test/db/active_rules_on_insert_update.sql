INSERT INTO keys VALUES ('test.alpha');
INSERT INTO keys VALUES ('test.beta');

SELECT active INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(NOT result.active);

INSERT INTO active_rules VALUES ('test.a*', t_minus('1 hour'));

SELECT active INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.active);

SELECT active INTO STRICT result FROM keys WHERE key = 'test.beta';
PERFORM assert(NOT result.active);

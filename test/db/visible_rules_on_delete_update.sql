INSERT INTO keys VALUES ('test.alpha');

INSERT INTO visible_rules VALUES ('test.a*', t_minus('1 hour'));

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.visible);

DELETE FROM visible_rules;

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(NOT result.visible);

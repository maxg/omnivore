INSERT INTO keys VALUES ('test.alpha');

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(NOT result.visible);

INSERT INTO visible_rules VALUES ('test.a*', t_minus('1 hour'));

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.visible);

UPDATE visible_rules SET keys = 'test.b*';

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(NOT result.visible);

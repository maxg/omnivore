INSERT INTO visible_rules VALUES ('test.a*', t_minus('1 hour'));

INSERT INTO keys VALUES ('test.alpha'), ('test.beta');

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.visible);

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.beta';
PERFORM assert(NOT result.visible);

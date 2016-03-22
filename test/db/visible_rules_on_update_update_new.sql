INSERT INTO keys VALUES ('test.alpha');

INSERT INTO visible_rules VALUES ('test.a*', t_plus('1 hour'));

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(NOT result.visible);

UPDATE visible_rules SET after = t_minus('1 hour');

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.visible);

UPDATE visible_rules SET after = t_plus('1 hour');

SELECT visible INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(NOT result.visible);

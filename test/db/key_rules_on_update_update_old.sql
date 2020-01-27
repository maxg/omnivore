INSERT INTO keys VALUES ('test.alpha');

INSERT INTO key_rules (keys, key_order, promotion, key_comment) VALUES ('test.a*', 1, 2, 'y');
INSERT INTO key_rules (keys, key_order, promotion, values_comment) VALUES ('test.a*', 2, 1, 'z');

SELECT * INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.key_order IS NOT DISTINCT FROM 2);
PERFORM assert(result.promotion IS NOT DISTINCT FROM 2);
PERFORM assert(result.key_comment IS NOT DISTINCT FROM 'y');
PERFORM assert(result.values_comment IS NOT DISTINCT FROM 'z');

UPDATE key_rules SET (keys, promotion) = ('test.b*', 3) WHERE values_comment = 'z';

SELECT * INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.key_order IS NOT DISTINCT FROM 1);
PERFORM assert(result.promotion IS NOT DISTINCT FROM 2);
PERFORM assert(result.key_comment IS NOT DISTINCT FROM 'y');
PERFORM assert(result.values_comment IS NULL);

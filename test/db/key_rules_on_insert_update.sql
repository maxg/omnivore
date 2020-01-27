INSERT INTO keys VALUES ('test.alpha');
INSERT INTO keys VALUES ('test.beta');

SELECT * INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.key_order IS NULL);
PERFORM assert(result.promotion IS NULL);
PERFORM assert(result.key_comment IS NULL);
PERFORM assert(result.values_comment IS NULL);

INSERT INTO key_rules (keys, key_order, promotion, key_comment) VALUES ('test.a*', 1, 2, 'y');

SELECT * INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.key_order IS NOT DISTINCT FROM 1);
PERFORM assert(result.promotion IS NOT DISTINCT FROM 2);
PERFORM assert(result.key_comment IS NOT DISTINCT FROM 'y');
PERFORM assert(result.values_comment IS NULL);

INSERT INTO key_rules (keys, key_order, promotion, values_comment) VALUES ('test.a*', 2, 1, 'z');

SELECT * INTO STRICT result FROM keys WHERE key = 'test.alpha';
PERFORM assert(result.key_order IS NOT DISTINCT FROM 2);
PERFORM assert(result.promotion IS NOT DISTINCT FROM 2);
PERFORM assert(result.key_comment IS NOT DISTINCT FROM 'y');
PERFORM assert(result.values_comment IS NOT DISTINCT FROM 'z');

SELECT * INTO STRICT result FROM keys WHERE key = 'test.beta';
PERFORM assert(result.key_order IS NULL);
PERFORM assert(result.promotion IS NULL);
PERFORM assert(result.key_comment IS NULL);
PERFORM assert(result.values_comment IS NULL);

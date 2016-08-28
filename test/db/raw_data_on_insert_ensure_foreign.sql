SELECT * INTO result FROM keys;
PERFORM assert(NOT FOUND, result::TEXT);

INSERT INTO raw_data VALUES ('alice', 'test.alpha', t(), '0', 'tester');

SELECT * INTO STRICT result FROM keys;
PERFORM assert(result.key = 'test.alpha');

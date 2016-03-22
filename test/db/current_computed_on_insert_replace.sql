INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '42');

SELECT * INTO STRICT result FROM all_computed;
PERFORM assert(result.value = '42', result::TEXT);

SELECT * INTO STRICT result FROM current_computed;
PERFORM assert(result.value = '42', result::TEXT);

INSERT INTO current_computed VALUES ('alice', 'test.beta', t(), '7');

-- TODO improve
SELECT count(*) AS count INTO STRICT result FROM all_computed;
PERFORM assert(result.count = 2, result::TEXT);

SELECT * INTO STRICT result FROM current_computed;
PERFORM assert(result.value = '7', result::TEXT);

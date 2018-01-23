BEGIN
    INSERT INTO raw_data VALUES('alice', 'extra.alpha', t(), '0', 'tester');
    PERFORM assert(FALSE);
EXCEPTION
    WHEN raise_exception THEN
END;

SELECT * INTO result FROM all_data;
PERFORM assert(NOT FOUND, result::TEXT);

INSERT INTO keys VALUES ('extra.alpha');

INSERT INTO raw_data VALUES('alice', 'extra.alpha', t(), '10', 'tester');

SELECT * INTO STRICT result FROM raw_data;
PERFORM assert(result.value = '10', result::TEXT);

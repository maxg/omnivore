BEGIN
    INSERT INTO raw_data VALUES('alice', 'not_a_test.alpha', t(), '0', 'tester');
    PERFORM assert(FALSE);
EXCEPTION
    WHEN raise_exception THEN
END;

SELECT * INTO result FROM all_data;
PERFORM assert(NOT FOUND, result::TEXT);

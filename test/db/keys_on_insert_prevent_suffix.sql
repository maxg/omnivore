INSERT INTO keys VALUES ('test.leaf');
BEGIN
    INSERT INTO keys VALUES ('test.leaf.ladybug');
    PERFORM assert(FALSE, 'expected exception');
EXCEPTION
    WHEN raise_exception THEN
END;

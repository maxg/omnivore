INSERT INTO keys VALUES ('test.stem.leaf');
BEGIN
    INSERT INTO keys VALUES ('test.stem');
    PERFORM assert(FALSE, 'expected exception');
EXCEPTION
    WHEN raise_exception THEN
END;

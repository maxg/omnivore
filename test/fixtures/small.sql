INSERT INTO staff VALUES ('nanoquizzer');

INSERT INTO agents VALUES ('nanoquizzer', '', ARRAY[ 'test.*{1}.nanoquiz' ]::LQUERY[]);

INSERT INTO visible_rules VALUES
    ('test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '3 day'),
    ('test.class_2.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '1 day');
    --('test.class_3.nanoquiz', missing)

INSERT INTO raw_data VALUES
    ('alice', 'test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '3 day', '10', 'tester'),
    ('bob',   'test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '3 day', '9',  'tester'),
    ('alice', 'test.class_2.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '1 day', '8', 'tester');
    --('bob', 'test.class_2.nanoquiz', missing)
    --(any, 'test.class_3.nanoquiz', missing)

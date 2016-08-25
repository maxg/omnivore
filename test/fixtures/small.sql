INSERT INTO staff VALUES ('super');

INSERT INTO agents VALUES ('super', '', ARRAY[ '*'::LQUERY ]);

INSERT INTO visible_rules VALUES
    ('test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '3 day'),
    ('test.class_2.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '1 day');

INSERT INTO raw_data VALUES
    ('alice', 'test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '3 day', '10', 'tester'),
    ('bob',   'test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '3 day', '9',  'tester'),
    ('alice', 'test.class_2.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '1 day', '8', 'tester');
    --('bob', 'test.class_2.nanoquiz', missing)

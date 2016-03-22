INSERT INTO visible_rules VALUES
    ('test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '1 day');

INSERT INTO raw_data VALUES
    ('alice', 'test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '1 day', '10', 'tester'),
    ('bob',   'test.class_1.nanoquiz', CURRENT_TIMESTAMP - INTERVAL '1 day', '9',  'tester');

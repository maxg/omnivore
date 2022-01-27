INSERT INTO staff VALUES ('nanoquizzer');
INSERT INTO staff VALUES ('rootstaffer');

INSERT INTO agents VALUES ('nanoquizzer', '', '{ "test.*{1}.nanoquiz" }', '{ "test.*{1}.nanoquiz" }');
INSERT INTO agents VALUES ('rootstaffer', '', '{ "*" }', '{ "*" }');

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

UPDATE users SET on_roster = true WHERE username IN (
  'alice'
  --'bob'
);

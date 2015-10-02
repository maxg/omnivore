PRAGMA foreign_keys = ON;

-- parent-child key relationships
CREATE TABLE IF NOT EXISTS keys (key PRIMARY KEY ASC, parent REFERENCES keys);
CREATE INDEX IF NOT EXISTS keys_parent_key ON keys (parent, key);

-- valued keys
CREATE TABLE IF NOT EXISTS leaves (key PRIMARY KEY REFERENCES keys);

-- active keys
CREATE TABLE IF NOT EXISTS active (key PRIMARY KEY REFERENCES leaves);
CREATE TRIGGER IF NOT EXISTS new_active_key BEFORE INSERT ON active BEGIN
    INSERT OR REPLACE INTO leaves
    SELECT key FROM keys WHERE key = NEW.key AND NOT EXISTS (SELECT * FROM keys WHERE parent = NEW.key);
    END;

-- visible keys
CREATE TABLE IF NOT EXISTS visible (key PRIMARY KEY REFERENCES leaves);
CREATE TRIGGER IF NOT EXISTS new_visible_key BEFORE INSERT ON visible BEGIN
    INSERT OR REPLACE INTO leaves
    SELECT key FROM keys WHERE key = NEW.key AND NOT EXISTS (SELECT * FROM keys WHERE parent = NEW.key);
    END;

-- ordered keys
CREATE TABLE IF NOT EXISTS ranks (key PRIMARY KEY REFERENCES leaves, rank NOT NULL);
CREATE TRIGGER IF NOT EXISTS new_ranks_key BEFORE INSERT ON ranks BEGIN
    INSERT OR REPLACE INTO leaves
    SELECT key FROM keys WHERE key = NEW.key AND NOT EXISTS (SELECT * FROM keys WHERE parent = NEW.key);
    END;

-- data types
CREATE TABLE IF NOT EXISTS types (type PRIMARY KEY);

-- deadlines applied to data
CREATE TABLE IF NOT EXISTS deadlines (key PRIMARY KEY REFERENCES leaves, due NOT NULL);
CREATE TRIGGER IF NOT EXISTS new_deadline_key BEFORE INSERT ON deadlines BEGIN
    INSERT OR REPLACE INTO leaves
    SELECT key FROM keys WHERE key = NEW.key AND NOT EXISTS (SELECT * FROM keys WHERE parent = NEW.key);
    END;
CREATE VIEW IF NOT EXISTS all_deadlines AS
    SELECT * FROM leaves LEFT NATURAL JOIN deadlines;

-- all data, without accounting for deadlines
CREATE TABLE IF NOT EXISTS all_data (user, key REFERENCES leaves, ts, type NOT NULL REFERENCES types, value NOT NULL,
    agent NOT NULL, created NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user, key, ts DESC)
    );
CREATE INDEX IF NOT EXISTS all_data_user_key ON all_data (user, key);
CREATE INDEX IF NOT EXISTS all_data_user ON all_data (user);
CREATE TRIGGER IF NOT EXISTS new_data_key BEFORE INSERT ON all_data
    WHEN NOT EXISTS (SELECT * FROM all_data WHERE key = NEW.key) BEGIN
    INSERT OR REPLACE INTO leaves
    SELECT key FROM keys WHERE key = NEW.key AND NOT EXISTS (SELECT * FROM keys WHERE parent = NEW.key);
    END;

-- current data, accounting for deadlines
CREATE TABLE IF NOT EXISTS current_data (user, key REFERENCES leaves, ts, type NOT NULL REFERENCES types, value NOT NULL,
    PRIMARY KEY (user, key),
    FOREIGN KEY (user, key, ts) REFERENCES all_data
    );
CREATE INDEX IF NOT EXISTS current_data_user ON current_data (user);
CREATE TRIGGER IF NOT EXISTS data_all_to_current AFTER INSERT ON all_data BEGIN
    INSERT OR REPLACE INTO current_data
    SELECT user, key, ts, type, value FROM
        (SELECT user, key, max(ts) AS ts FROM
            (SELECT due FROM all_deadlines WHERE key = NEW.key)
            JOIN
            (SELECT user, key, ts FROM all_data WHERE user = NEW.user AND key = NEW.key)
            ON (due IS NULL OR ts <= due)
        )
        NATURAL JOIN all_data;
    END;

CREATE TRIGGER IF NOT EXISTS new_deadline_stale AFTER INSERT ON deadlines BEGIN
    DELETE FROM current_data WHERE key = NEW.key AND ts > NEW.due;
    INSERT OR REPLACE INTO current_data
    SELECT user, key, ts, type, value FROM
        (
            SELECT user, key, max(ts) AS ts FROM all_data
            WHERE key = NEW.key AND ts <= NEW.due
            GROUP BY user, key
        )
        NATURAL JOIN all_data;
    END;

-- all computed results, including out-of-date
CREATE TABLE IF NOT EXISTS all_computed (user, key REFERENCES leaves, ts, type NOT NULL REFERENCES types, value NOT NULL,
    created NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user, key, ts DESC)
    );
CREATE INDEX IF NOT EXISTS all_computed_user_key ON all_computed (user, key);
CREATE INDEX IF NOT EXISTS all_computed_user ON all_computed (user);
CREATE TRIGGER IF NOT EXISTS new_computed_key BEFORE INSERT ON all_computed
    WHEN NOT EXISTS (SELECT * FROM all_computed WHERE key = NEW.key) BEGIN
    INSERT OR REPLACE INTO leaves
    SELECT key FROM keys WHERE key = NEW.key AND NOT EXISTS (SELECT * FROM keys WHERE parent = NEW.key);
    END;
-- current computed results
CREATE TABLE IF NOT EXISTS current_computed (user, key REFERENCES leaves, ts, type NOT NULL REFERENCES types, value NOT NULL,
    PRIMARY KEY (user, key),
    FOREIGN KEY (user, key, ts) REFERENCES all_computed
    );
CREATE INDEX IF NOT EXISTS current_computed_user ON current_computed (user);
CREATE TRIGGER IF NOT EXISTS computed_all_to_current AFTER INSERT ON all_computed BEGIN
    INSERT OR REPLACE INTO current_computed
    SELECT user, key, ts, type, value FROM all_computed WHERE user = NEW.user AND key = NEW.key
    ORDER BY ts DESC
    LIMIT 1;
    END;

-- concrete dataflow from inputs to outputs
CREATE TABLE IF NOT EXISTS dataflow (output REFERENCES leaves, input REFERENCES leaves,
    PRIMARY KEY (output, input)
    );
CREATE INDEX IF NOT EXISTS dataflow_in_out ON dataflow (input, output);
CREATE TRIGGER IF NOT EXISTS new_dataflow_keys BEFORE INSERT ON dataflow BEGIN
    INSERT OR REPLACE INTO leaves
    SELECT key FROM keys WHERE key = NEW.input AND NOT EXISTS (SELECT * FROM keys WHERE parent = NEW.input)
    UNION
    SELECT key FROM keys WHERE key = NEW.output AND NOT EXISTS (SELECT * FROM keys WHERE parent = NEW.output);
    END;

CREATE TRIGGER IF NOT EXISTS new_key_stale AFTER INSERT ON active BEGIN
    DELETE FROM current_computed WHERE key IN (SELECT output FROM dataflow WHERE input = NEW.key);
    END;
CREATE TRIGGER IF NOT EXISTS del_key_stale AFTER DELETE ON active BEGIN
    DELETE FROM current_computed WHERE key IN (SELECT output FROM dataflow WHERE input = OLD.key);
    END;
CREATE TRIGGER IF NOT EXISTS new_dataflow_stale AFTER INSERT ON dataflow BEGIN
    DELETE FROM current_computed WHERE key = NEW.output;
    END;
CREATE TRIGGER IF NOT EXISTS new_data_stale AFTER INSERT ON current_data BEGIN
    DELETE FROM current_computed WHERE key IN (SELECT output from dataflow WHERE input = NEW.key) AND user = NEW.user;
    END;
CREATE TRIGGER IF NOT EXISTS del_data_stale AFTER DELETE ON current_data BEGIN
    DELETE FROM current_computed WHERE key IN (SELECT output from dataflow WHERE input = OLD.key) AND user = OLD.user;
    END;
CREATE TRIGGER IF NOT EXISTS new_computed_stale AFTER INSERT ON current_computed BEGIN
    DELETE FROM current_computed WHERE key IN (SELECT output from dataflow WHERE input = NEW.key) AND user = NEW.user;
    END;
CREATE TRIGGER IF NOT EXISTS del_computed_stale AFTER DELETE ON current_computed BEGIN
    DELETE FROM current_computed WHERE key IN (SELECT output from dataflow WHERE input = OLD.key) AND user = OLD.user;
    END;

DROP VIEW IF EXISTS keyinfo;
CREATE VIEW keyinfo AS
    SELECT * FROM
    keys
    NATURAL LEFT JOIN
    (SELECT key, 1 AS leaf FROM leaves)
    NATURAL LEFT JOIN
    (SELECT key, 1 AS active FROM active)
    NATURAL LEFT JOIN
    (SELECT key, 1 AS visible FROM visible)
    NATURAL LEFT JOIN
    ranks
    NATURAL LEFT JOIN
    deadlines
    NATURAL LEFT JOIN
    (SELECT DISTINCT output AS key, 1 AS compute FROM dataflow)
    NATURAL LEFT JOIN
    (SELECT DISTINCT parent AS key, 1 AS children FROM keys)
    ORDER BY parent, rank, key
    ;

DROP VIEW IF EXISTS grades;
CREATE VIEW grades AS
    SELECT user, key, parent,
           ifnull(ts, comp_ts) AS ts, ifnull(type, comp_type) AS type, ifnull(value, comp_value) AS value,
           CASE WHEN ts IS NULL THEN computed ELSE NULL END AS computed,
           leaf, active, visible, due, compute, children FROM
    (SELECT DISTINCT user FROM current_data)
    JOIN
    (SELECT * FROM leaves)
    NATURAL LEFT JOIN
    current_data
    NATURAL LEFT JOIN
    (SELECT user, key, ts AS comp_ts, type AS comp_type, value AS comp_value, 1 AS computed FROM current_computed)
    NATURAL LEFT JOIN
    keyinfo
    ORDER BY user, parent, rank, key
    ;

DROP VIEW IF EXISTS history;
CREATE VIEW history AS
    SELECT * FROM
    (
        SELECT user, key, ts, type, value, NULL AS computed FROM all_data
        UNION
        SELECT user, key, ts, type, value, 1 AS computed FROM all_computed
    )
    NATURAL LEFT JOIN
    keyinfo
    ORDER BY user, key, ts DESC
    ;

-- root key
INSERT OR IGNORE INTO keys VALUES ('/', '/');

-- allowed types
INSERT OR IGNORE INTO types VALUES ('boolean'), ('number'), ('string');

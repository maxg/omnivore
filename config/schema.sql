CREATE DOMAIN wordtext AS TEXT CHECK (VALUE ~ '^[a-z0-9_]+$');
CREATE DOMAIN identtext AS TEXT CHECK (VALUE ~ '^[a-z0-9_-]+$');

CREATE TABLE IF NOT EXISTS staff (
    username wordtext NOT NULL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS agents (
    agent wordtext NOT NULL PRIMARY KEY,
    public_key TEXT NOT NULL,
    add LQUERY[] NOT NULL,
    write LQUERY[] NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    username wordtext NOT NULL PRIMARY KEY,
    on_roster BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS active_rules (
    keys LQUERY NOT NULL,
    after TIMESTAMP(3) WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS visible_rules (
    keys LQUERY NOT NULL,
    after TIMESTAMP(3) WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS penalties (
    penalty_id identtext NOT NULL PRIMARY KEY,
    penalty_description TEXT NOT NULL,
    penalize TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deadline_rules (
    keys LQUERY NOT NULL,
    deadline TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    penalty_id TEXT NOT NULL REFERENCES penalties
);

CREATE TABLE IF NOT EXISTS keys (
    key LTREE NOT NULL PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    visible BOOLEAN NOT NULL DEFAULT FALSE,
    deadline TIMESTAMP(3) WITH TIME ZONE,
    penalty_id TEXT REFERENCES penalties
);
CREATE INDEX keys_key_gist ON keys USING gist(key);
CREATE INDEX keys_active_visible_idx ON keys (active, visible);

CREATE OR REPLACE FUNCTION keys_prevent_prefixes() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM keys WHERE key <@ NEW.key) THEN
        RAISE EXCEPTION 'key % is a prefix of an existing key', NEW.key;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER keys_on_insert_prevent_prefixes BEFORE INSERT ON keys
    FOR EACH ROW EXECUTE PROCEDURE keys_prevent_prefixes();

-- TODO no overlapping *_rules? or latest rule applies? or ...?

CREATE OR REPLACE FUNCTION keys_apply_rules() RETURNS TRIGGER AS $$
BEGIN
    NEW.active = EXISTS(SELECT 1 FROM active_rules WHERE NEW.key ~ keys AND after <= CURRENT_TIMESTAMP);
    NEW.visible = EXISTS(SELECT 1 FROM visible_rules WHERE NEW.key ~ keys AND after <= CURRENT_TIMESTAMP);
    NEW.deadline = (SELECT deadline FROM deadline_rules WHERE NEW.key ~ keys);
    NEW.penalty_id = (SELECT penalty_id FROM deadline_rules WHERE NEW.key ~ keys);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER keys_on_insert_apply_rules BEFORE INSERT ON keys
    FOR EACH ROW EXECUTE PROCEDURE keys_apply_rules();

CREATE OR REPLACE RULE active_rules_on_insert_update AS ON INSERT TO active_rules
    DO UPDATE keys SET active = NEW.after <= CURRENT_TIMESTAMP WHERE key ~ NEW.keys;

CREATE OR REPLACE RULE active_rules_on_update_update_old AS ON UPDATE TO active_rules
    DO UPDATE keys SET active = FALSE WHERE key ~ OLD.keys AND NOT key ~ NEW.keys;

CREATE OR REPLACE RULE active_rules_on_update_update_new AS ON UPDATE TO active_rules
    DO UPDATE keys SET active = NEW.after <= CURRENT_TIMESTAMP WHERE key ~ NEW.keys;

CREATE OR REPLACE RULE active_rules_on_delete_update AS ON DELETE TO active_rules
    DO UPDATE keys SET active = FALSE WHERE key ~ OLD.keys;

CREATE OR REPLACE RULE visible_rules_on_insert_update AS ON INSERT TO visible_rules
    DO UPDATE keys SET visible = NEW.after <= CURRENT_TIMESTAMP WHERE key ~ NEW.keys;

CREATE OR REPLACE RULE visible_rules_on_update_update_old AS ON UPDATE TO visible_rules
    DO UPDATE keys SET visible = FALSE WHERE key ~ OLD.keys AND NOT key ~ NEW.keys;

CREATE OR REPLACE RULE visible_rules_on_update_update_new AS ON UPDATE TO visible_rules
    DO UPDATE keys SET visible = NEW.after <= CURRENT_TIMESTAMP WHERE key ~ NEW.keys;

CREATE OR REPLACE RULE visible_rules_on_delete_update AS ON DELETE TO visible_rules
    DO UPDATE keys SET visible = FALSE WHERE key ~ OLD.keys;

CREATE OR REPLACE RULE deadline_rules_on_insert_update AS ON INSERT TO deadline_rules
    DO UPDATE keys SET deadline = NEW.deadline, penalty_id = NEW.penalty_id WHERE key ~ NEW.keys;

CREATE OR REPLACE RULE deadline_rules_on_update_update_old AS ON UPDATE TO deadline_rules
    DO UPDATE keys SET deadline = NULL, penalty_id = NULL WHERE key ~ OLD.keys AND NOT key ~ NEW.keys;

CREATE OR REPLACE RULE deadline_rules_on_update_update_new AS ON UPDATE TO deadline_rules
    DO UPDATE keys SET deadline = NEW.deadline, penalty_id = NEW.penalty_id WHERE key ~ NEW.keys;

CREATE OR REPLACE RULE deadline_rules_on_delete_update AS ON DELETE TO deadline_rules
    DO UPDATE keys SET deadline = NULL, penalty_id = NULL WHERE key ~ OLD.keys;

CREATE TABLE IF NOT EXISTS key_orders (
    key LTREE NOT NULL PRIMARY KEY REFERENCES keys,
    key_order SMALLINT NOT NULL,
    UNIQUE (key, key_order)
);

CREATE TABLE IF NOT EXISTS raw_data (
    username TEXT NOT NULL REFERENCES users,
    key LTREE NOT NULL REFERENCES keys,
    ts TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    value JSONB NOT NULL,
    agent TEXT NOT NULL REFERENCES agents,
    created TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, key, ts),
    UNIQUE (username, key, ts, agent)
);
CREATE INDEX raw_data_key_gist ON raw_data USING gist(key);

CREATE OR REPLACE FUNCTION raw_data_ignore_duplicate() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM raw_data WHERE username = NEW.username AND key = NEW.key AND ts = NEW.ts AND value = NEW.value) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER raw_data_on_insert_ignore_duplicate BEFORE INSERT ON raw_data
    FOR EACH ROW EXECUTE PROCEDURE raw_data_ignore_duplicate();

-- XXX improve w/o breaking concurrent transactions?
CREATE OR REPLACE FUNCTION raw_data_ensure_foreign() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO users (username) VALUES (NEW.username) ON CONFLICT DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM keys WHERE key = NEW.key) THEN
        IF NOT NEW.key ? (SELECT add FROM agents WHERE agent = NEW.agent) THEN
            RAISE EXCEPTION 'agent % cannot add new key %', NEW.agent, NEW.key;
        END IF;
        LOCK TABLE keys IN SHARE ROW EXCLUSIVE MODE;
        INSERT INTO keys (key) SELECT NEW.key WHERE NOT EXISTS (SELECT 1 FROM keys WHERE key = NEW.key);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER raw_data_on_insert_ensure_foreign BEFORE INSERT ON raw_data
    FOR EACH ROW EXECUTE PROCEDURE raw_data_ensure_foreign();

CREATE OR REPLACE FUNCTION raw_data_check_agent() RETURNS TRIGGER AS $$
BEGIN
    IF NOT NEW.key ? (SELECT write FROM agents WHERE agent = NEW.agent) THEN
        RAISE EXCEPTION 'agent % cannot write key %', NEW.agent, NEW.key;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER raw_data_on_insert_check_agent BEFORE INSERT ON raw_data
    FOR EACH ROW EXECUTE PROCEDURE raw_data_check_agent();

CREATE OR REPLACE RULE raw_data_prevent_update AS ON UPDATE TO raw_data DO INSTEAD NOTHING;

CREATE OR REPLACE RULE raw_data_prevent_delete AS ON DELETE TO raw_data DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS all_data (
    username TEXT NOT NULL REFERENCES users,
    key LTREE NOT NULL REFERENCES keys,
    ts TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    value JSONB NOT NULL,
    penalty_applied TEXT REFERENCES penalties(penalty_id),
    agent TEXT NOT NULL REFERENCES agents,
    created TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (username, key, ts, value, penalty_applied, agent),
    CONSTRAINT all_data_refs_raw_data FOREIGN KEY (username, key, ts, agent) REFERENCES raw_data (username, key, ts, agent)
);
CREATE UNIQUE INDEX all_data_unique_with_null_penalty_applied ON all_data (username, key, ts, value, agent) WHERE penalty_applied IS NULL;
CREATE INDEX all_data_key_gist ON all_data USING gist(key);

CREATE OR REPLACE RULE all_data_prevent_update AS ON UPDATE TO all_data DO INSTEAD NOTHING;

CREATE OR REPLACE RULE all_data_prevent_delete AS ON DELETE TO all_data DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS current_data (
    username TEXT NOT NULL REFERENCES users,
    key LTREE NOT NULL REFERENCES keys,
    ts TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    value JSONB NOT NULL,
    penalty_applied TEXT REFERENCES penalties(penalty_id),
    agent TEXT NOT NULL REFERENCES agents,
    created TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, key),
    CONSTRAINT current_data_refs_all_data FOREIGN KEY (username, key, ts, value, penalty_applied, agent) REFERENCES all_data (username, key, ts, value, penalty_applied, agent)
);
CREATE INDEX current_data_key_gist ON current_data USING gist(key);

-- TODO test this trigger!
CREATE OR REPLACE FUNCTION current_data_replace() RETURNS TRIGGER AS $$
BEGIN
    BEGIN
        INSERT INTO all_data SELECT NEW.*;
    EXCEPTION
        WHEN unique_violation THEN -- TODO is this the best way to handle re-inserting duplicate data?
    END;
    DELETE FROM current_data WHERE username = NEW.username AND key = NEW.key;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER current_data_on_insert_replace BEFORE INSERT ON current_data
    FOR EACH ROW EXECUTE PROCEDURE current_data_replace();

CREATE OR REPLACE RULE current_data_prevent_update AS ON UPDATE TO current_data DO INSTEAD NOTHING;

CREATE OR REPLACE RULE keys_on_update_delete_stale_current AS ON UPDATE TO keys
    WHERE NEW.deadline IS DISTINCT FROM OLD.deadline OR NEW.penalty_id IS DISTINCT FROM OLD.penalty_id
    DO DELETE FROM current_data WHERE key = NEW.key;

CREATE OR REPLACE RULE raw_data_on_insert_delete_stale_current AS ON INSERT TO raw_data
    DO DELETE FROM current_data WHERE key = NEW.key AND username = NEW.username;

CREATE OR REPLACE RULE raw_data_on_delete_delete_stale_current AS ON DELETE TO raw_data
    DO DELETE FROM current_data WHERE key = OLD.key AND username = OLD.username;

CREATE TABLE IF NOT EXISTS all_computed (
    username TEXT NOT NULL REFERENCES users,
    key LTREE NOT NULL REFERENCES keys,
    ts TIMESTAMP(3) WITH TIME ZONE,
    value JSONB,
    penalty_applied TEXT REFERENCES penalties(penalty_id),
    created TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (username, key, ts, value, penalty_applied)
);
CREATE UNIQUE INDEX all_computed_unique_with_null_penalty_applied ON all_computed (username, key, ts, value) WHERE penalty_applied IS NULL;
CREATE INDEX all_computed_key_gist ON all_computed USING gist(key);

-- XXX improve w/o breaking concurrent transactions?
CREATE OR REPLACE FUNCTION all_computed_ensure_foreign() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO users (username) VALUES (NEW.username) ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER all_computed_on_insert_ensure_foreign BEFORE INSERT ON all_computed
    FOR EACH ROW EXECUTE PROCEDURE all_computed_ensure_foreign();

CREATE OR REPLACE FUNCTION all_computed_ensure_key() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO keys (key) SELECT NEW.key WHERE NOT EXISTS (SELECT 1 FROM keys WHERE key = NEW.key);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER all_computed_on_insert_ensure_key BEFORE INSERT ON all_computed
    FOR EACH ROW EXECUTE PROCEDURE all_computed_ensure_key();

CREATE OR REPLACE RULE all_computed_prevent_update AS ON UPDATE TO all_computed DO INSTEAD NOTHING;

CREATE OR REPLACE RULE all_computed_prevent_delete AS ON DELETE TO all_computed DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS current_computed (
    username TEXT NOT NULL REFERENCES users,
    key LTREE NOT NULL REFERENCES keys,
    ts TIMESTAMP(3) WITH TIME ZONE,
    value JSONB,
    penalty_applied TEXT REFERENCES penalties(penalty_id),
    created TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, key),
    CONSTRAINT current_computed_refs_all_computed FOREIGN KEY (username, key, ts, value, penalty_applied) REFERENCES all_computed (username, key, ts, value, penalty_applied)
);
CREATE INDEX current_computed_key_gist ON current_computed USING gist(key);

-- TODO must actually have the same row, not just the same key triple!
-- TODO must be the row with the largest ts?

-- TODO test me
CREATE OR REPLACE FUNCTION current_computed_replace() RETURNS TRIGGER AS $$
BEGIN
    BEGIN
        INSERT INTO all_computed SELECT NEW.*;
    EXCEPTION
        WHEN unique_violation THEN -- TODO is this best way to handle re-inserting duplicate computed value?
    END;
    DELETE FROM current_computed WHERE username = NEW.username AND key = NEW.key;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER current_computed_on_insert_replace BEFORE INSERT ON current_computed
    FOR EACH ROW EXECUTE PROCEDURE current_computed_replace();

CREATE OR REPLACE RULE current_computed_prevent_update AS ON UPDATE TO current_computed DO INSTEAD NOTHING;

CREATE OR REPLACE RULE raw_data_on_insert_delete_overridden_computed AS ON INSERT TO raw_data
    DO DELETE FROM current_computed WHERE key = NEW.key AND username = NEW.username;

CREATE OR REPLACE RULE raw_data_on_delete_delete_overridden_computed AS ON DELETE TO raw_data
    DO DELETE FROM current_computed WHERE key = OLD.key AND username = OLD.username;

CREATE TABLE IF NOT EXISTS computation_rules (
    base LQUERY NOT NULL,
    output LTREE NOT NULL,
    inputs LQUERY[] NOT NULL,
    compute TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS computations (
    output LTREE NOT NULL PRIMARY KEY REFERENCES keys,
    inputs LQUERY[] NOT NULL,
    compute TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION computation_rules_new_key() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO computations SELECT prefix || output, array_agg(prefix::TEXT || '.' || input ORDER BY ordinality)::LQUERY[], compute FROM
    (
        SELECT prefix, output, input, ordinality, compute FROM
        (
            SELECT subpath(NEW.key,0,split) AS prefix, subpath(NEW.key,split) AS suffix
            FROM generate_series(1,nlevel(NEW.key)-1) AS split
        ) AS splits
        JOIN computation_rules ON (prefix ~ base AND suffix ? inputs),
        LATERAL unnest(inputs) WITH ORDINALITY AS input
    ) AS comp
    WHERE NOT EXISTS (SELECT 1 FROM computations WHERE output = prefix || comp.output)
    GROUP BY prefix, output, compute;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER keys_on_insert_insert_computations AFTER INSERT ON keys
    FOR EACH ROW EXECUTE PROCEDURE computation_rules_new_key();

CREATE OR REPLACE FUNCTION computation_rules_new_rule() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO computations SELECT prefix || NEW.output, array_agg(prefix::TEXT || '.' || input ORDER BY ordinality)::LQUERY[], NEW.compute FROM
    (
        SELECT DISTINCT subpath(key,0,split)::TEXT AS prefix, input, ordinality FROM
        (
            SELECT key, generate_series(1,nlevel(key)-1) AS split FROM
            keys
            WHERE key ~ ANY (SELECT (NEW.base || '.' || unnest(NEW.inputs))::LQUERY)
        ) AS splits,
        LATERAL unnest(NEW.inputs::TEXT[]) WITH ORDINALITY AS input
        WHERE subpath(key,0,split) ~ NEW.base AND subpath(key,split) ? NEW.inputs
    ) AS comp
    GROUP BY prefix;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER computation_rules_on_insert_insert_computations AFTER INSERT ON computation_rules
    FOR EACH ROW EXECUTE PROCEDURE computation_rules_new_rule();

CREATE OR REPLACE RULE computation_rules_on_delete_delete_computations AS ON DELETE TO computation_rules
  DO DELETE FROM computations WHERE output ~ (OLD.base::TEXT || '.' || OLD.output::TEXT)::LQUERY;

CREATE OR REPLACE FUNCTION computations_ignore_duplicate() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM computations WHERE output::TEXT = NEW.output::TEXT AND inputs::TEXT[] = NEW.inputs::TEXT[] AND compute = NEW.compute) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER computations_on_insert_ignore_duplicate BEFORE INSERT ON computations
    FOR EACH ROW EXECUTE PROCEDURE computations_ignore_duplicate();

CREATE OR REPLACE FUNCTION computations_ensure_key() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO keys (key) SELECT NEW.output WHERE NOT EXISTS (SELECT 1 FROM keys WHERE key = NEW.output);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER computations_on_insert_ensure_key BEFORE INSERT ON computations
    FOR EACH ROW EXECUTE PROCEDURE computations_ensure_key();

CREATE OR REPLACE RULE keys_on_insert_delete_stale_computed AS ON INSERT TO keys
    WHERE NEW.active
    DO DELETE FROM current_computed WHERE key IN (
        WITH RECURSIVE all_computations AS (
            SELECT * FROM computations WHERE NEW.key ? inputs
            UNION ALL
            SELECT c.* FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );

CREATE OR REPLACE RULE keys_on_update_delete_stale_computed AS ON UPDATE TO keys
    WHERE NEW.active <> OLD.active
    DO DELETE FROM current_computed WHERE key IN (
        WITH RECURSIVE all_computations AS (
            SELECT * FROM computations WHERE NEW.key ? inputs
            UNION ALL
            SELECT c.* FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );

CREATE OR REPLACE RULE keys_on_delete_delete_stale_computed AS ON DELETE TO keys
    WHERE OLD.active
    DO DELETE FROM current_computed WHERE key IN (
        WITH RECURSIVE all_computations AS (
            SELECT * FROM computations WHERE OLD.key ? inputs
            UNION ALL
            SELECT c.* FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );

CREATE OR REPLACE RULE raw_data_on_insert_delete_stale_computed AS ON INSERT TO raw_data
    WHERE EXISTS (SELECT 1 FROM keys WHERE key = NEW.key AND active)
    DO DELETE FROM current_computed WHERE username = NEW.username AND key IN (
        WITH RECURSIVE all_computations AS (
            SELECT * FROM computations WHERE NEW.key ? inputs
            UNION ALL
            SELECT c.* FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );

CREATE OR REPLACE RULE current_data_on_insert_delete_stale_computed AS ON INSERT TO current_data
    WHERE EXISTS (SELECT 1 FROM keys WHERE key = NEW.key AND active)
    DO DELETE FROM current_computed WHERE key IN (SELECT output FROM computations WHERE NEW.key ? inputs)
                                          AND username = NEW.username;

CREATE OR REPLACE RULE current_data_on_delete_delete_stale_computed AS ON DELETE TO current_data
    WHERE EXISTS (SELECT 1 FROM keys WHERE key = OLD.key AND active)
    DO DELETE FROM current_computed WHERE key IN (SELECT output FROM computations WHERE OLD.key ? inputs)
                                          AND username = OLD.username;

CREATE OR REPLACE RULE current_computed_on_insert_delete_stale_computed AS ON INSERT TO current_computed
    WHERE EXISTS (SELECT 1 FROM keys WHERE key = NEW.key AND active)
    DO DELETE FROM current_computed WHERE key IN (SELECT output FROM computations WHERE NEW.key ? inputs)
                                          AND username = NEW.username;

CREATE OR REPLACE FUNCTION recursive_delete_stale_computed() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM keys WHERE key = OLD.key AND active) THEN
    DELETE FROM current_computed WHERE key in (SELECT output FROM computations WHERE OLD.key ? inputs)
                                       AND username = OLD.username;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER current_computed_on_delete_delete_stale_computed AFTER DELETE ON current_computed
    FOR EACH ROW EXECUTE PROCEDURE recursive_delete_stale_computed();

CREATE OR REPLACE RULE computations_on_insert_delete_stale_computed AS ON INSERT TO computations
    DO DELETE FROM current_computed WHERE key IN (
        WITH RECURSIVE all_computations AS (
            SELECT NEW.* UNION ALL SELECT c.* FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );

CREATE OR REPLACE RULE computations_on_update_delete_stale_computed AS ON UPDATE TO computations
    DO DELETE FROM current_computed WHERE key IN (
        WITH RECURSIVE all_computations AS (
            SELECT NEW.* UNION ALL SELECT c.* FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );

CREATE OR REPLACE RULE computations_on_delete_delete_stale_computed AS ON DELETE TO computations
    DO DELETE FROM current_computed WHERE key IN (
        WITH RECURSIVE all_computations AS (
            SELECT OLD.* UNION ALL SELECT c.* FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );

CREATE OR REPLACE VIEW raw_grades AS
    SELECT username, key, active, visible, deadline, penalty_id, penalty_description, penalize, ts, value, agent, created FROM
    (
        SELECT *, ROW_NUMBER() OVER (
            PARTITION BY username, key
            ORDER BY CASE WHEN deadline IS NULL OR ts <= deadline THEN EXTRACT(EPOCH FROM ts) ELSE EXTRACT(EPOCH FROM deadline-ts) END DESC
            ) AS k FROM
        keys
        LEFT JOIN
        penalties USING (penalty_id)
        JOIN
        raw_data USING (key)
    ) ranked
    WHERE k = 1
;

CREATE OR REPLACE VIEW grades AS
    SELECT users.*, keys.*, key_order, penalty_description, penalize, raw_data, computations.*,
        COALESCE(data.ts, comp.ts) AS ts,
        COALESCE(data.value, comp.value) AS value,
        CASE WHEN data.value IS NOT NULL THEN data.penalty_applied ELSE comp.penalty_applied END AS penalty_applied,
        agent,
        COALESCE(data.created, comp.created) AS created,
        CASE WHEN data.value IS NOT NULL THEN FALSE WHEN comp.value IS NOT NULL THEN TRUE ELSE NULL END AS computed
    FROM
    users
    CROSS JOIN
    keys
    LEFT JOIN
    key_orders USING (key)
    LEFT JOIN
    penalties USING (penalty_id)
    LEFT JOIN
    (
        SELECT true as raw_data, username, key FROM raw_data GROUP BY username, key
    ) raw USING (username, key)
    LEFT JOIN
    computations ON keys.key = computations.output
    LEFT JOIN
    current_data AS data USING (username, key)
    LEFT JOIN
    current_computed AS comp USING (username, key)
;

CREATE OR REPLACE VIEW history AS
    SELECT * FROM
    keys
    JOIN
    (
        SELECT username, key, ts, value, null AS penalty_applied, created, TRUE AS raw, FALSE AS computed FROM raw_data
        UNION
        SELECT username, key, ts, value, penalty_applied, created, FALSE AS raw, FALSE AS computed FROM all_data
        UNION
        SELECT username, key, ts, value, penalty_applied, created, FALSE AS raw, TRUE AS computed FROM all_computed
    ) combined USING (key)
;

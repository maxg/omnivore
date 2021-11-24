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

CREATE TABLE IF NOT EXISTS key_rules (
    keys LQUERY NOT NULL,
    key_order SMALLINT,
    promotion SMALLINT,
    key_comment TEXT,
    values_comment TEXT
);

CREATE TABLE IF NOT EXISTS keys (
    key LTREE NOT NULL PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    visible BOOLEAN NOT NULL DEFAULT FALSE,
    deadline TIMESTAMP(3) WITH TIME ZONE,
    penalty_id TEXT REFERENCES penalties,
    key_order SMALLINT,
    promotion SMALLINT,
    key_comment TEXT,
    values_comment TEXT
);
CREATE INDEX keys_key_gist ON keys USING gist(key);
CREATE INDEX keys_active_visible_idx ON keys (active, visible);

CREATE OR REPLACE FUNCTION keys_prevent_prefixes() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM keys WHERE key <@ NEW.key) THEN
        RAISE EXCEPTION 'key % is a prefix of an existing key', NEW.key;
    END IF;
    IF EXISTS (SELECT 1 FROM keys WHERE key @> NEW.key) THEN
        RAISE EXCEPTION 'key % is a suffix of an existing key', NEW.key;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER keys_on_insert_prevent_prefixes BEFORE INSERT ON keys
    FOR EACH ROW EXECUTE PROCEDURE keys_prevent_prefixes();

CREATE OR REPLACE FUNCTION keys_apply_rules() RETURNS TRIGGER AS $$
BEGIN
    NEW.active = (SELECT COALESCE(MIN(after) <= CURRENT_TIMESTAMP, FALSE) FROM active_rules WHERE NEW.key ~ keys);
    NEW.visible = (SELECT COALESCE(MIN(after) <= CURRENT_TIMESTAMP, FALSE) FROM visible_rules WHERE NEW.key ~ keys);
    NEW.deadline = (SELECT MIN(deadline) FROM deadline_rules WHERE NEW.key ~ keys);
    NEW.penalty_id = (SELECT MIN(penalty_id) FROM deadline_rules WHERE NEW.key ~ keys);
    NEW.key_order = (SELECT MAX(key_order) FROM key_rules WHERE NEW.key ~ keys);
    NEW.promotion = (SELECT MAX(promotion) FROM key_rules WHERE NEW.key ~ keys);
    NEW.key_comment = (SELECT MAX(key_comment) FROM key_rules WHERE NEW.key ~ keys);
    NEW.values_comment = (SELECT MAX(values_comment) FROM key_rules WHERE NEW.key ~ keys);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER keys_on_insert_apply_rules BEFORE INSERT ON keys
    FOR EACH ROW EXECUTE PROCEDURE keys_apply_rules();

CREATE OR REPLACE FUNCTION active_rules_apply_rules() RETURNS TRIGGER AS $$
BEGIN
    UPDATE keys SET active = (SELECT COALESCE(MIN(after) <= CURRENT_TIMESTAMP, FALSE) FROM active_rules WHERE key ~ keys)
    WHERE key ~ NEW.keys OR key ~ OLD.keys;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER active_rules_on_insert_apply_rules AFTER INSERT ON active_rules
    FOR EACH ROW EXECUTE PROCEDURE active_rules_apply_rules();
CREATE TRIGGER active_rules_on_update_apply_rules AFTER UPDATE ON active_rules
    FOR EACH ROW EXECUTE PROCEDURE active_rules_apply_rules();
CREATE TRIGGER active_rules_on_delete_apply_rules AFTER DELETE ON active_rules
    FOR EACH ROW EXECUTE PROCEDURE active_rules_apply_rules();

CREATE OR REPLACE FUNCTION visible_rules_apply_rules() RETURNS TRIGGER AS $$
BEGIN
    UPDATE keys SET visible = (SELECT COALESCE(MIN(after) <= CURRENT_TIMESTAMP, FALSE) FROM visible_rules WHERE key ~ keys)
    WHERE key ~ NEW.keys OR key ~ OLD.keys;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER visible_rules_on_insert_apply_rules AFTER INSERT ON visible_rules
    FOR EACH ROW EXECUTE PROCEDURE visible_rules_apply_rules();
CREATE TRIGGER visible_rules_on_update_apply_rules AFTER UPDATE ON visible_rules
    FOR EACH ROW EXECUTE PROCEDURE visible_rules_apply_rules();
CREATE TRIGGER visible_rules_on_delete_apply_rules AFTER DELETE ON visible_rules
    FOR EACH ROW EXECUTE PROCEDURE visible_rules_apply_rules();

CREATE OR REPLACE FUNCTION deadline_rules_apply_rules() RETURNS TRIGGER AS $$
BEGIN
    UPDATE keys SET deadline = (SELECT MIN(deadline) FROM deadline_rules WHERE key ~ keys),
                    penalty_id = (SELECT MIN(penalty_id) FROM deadline_rules WHERE key ~ keys)
    WHERE key ~ NEW.keys OR key ~ OLD.keys;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER deadline_rules_on_insert_apply_rules AFTER INSERT ON deadline_rules
    FOR EACH ROW EXECUTE PROCEDURE deadline_rules_apply_rules();
CREATE TRIGGER deadline_rules_on_update_apply_rules AFTER UPDATE ON deadline_rules
    FOR EACH ROW EXECUTE PROCEDURE deadline_rules_apply_rules();
CREATE TRIGGER deadline_rules_on_delete_apply_rules AFTER DELETE ON deadline_rules
    FOR EACH ROW EXECUTE PROCEDURE deadline_rules_apply_rules();

CREATE OR REPLACE FUNCTION key_rules_apply_rules() RETURNS TRIGGER AS $$
BEGIN
    UPDATE keys SET (key_order, promotion, key_comment, values_comment) =
        (SELECT MAX(key_order), MAX(promotion), MAX(key_comment), MAX(values_comment) FROM key_rules WHERE key ~ keys)
    WHERE key ~ NEW.keys OR key ~ OLD.keys;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER key_rules_on_insert_apply_rules AFTER INSERT ON key_rules
    FOR EACH ROW EXECUTE PROCEDURE key_rules_apply_rules();
CREATE TRIGGER key_rules_on_update_apply_rules AFTER UPDATE ON key_rules
    FOR EACH ROW EXECUTE PROCEDURE key_rules_apply_rules();
CREATE TRIGGER key_rules_on_delete_apply_rules AFTER DELETE ON key_rules
    FOR EACH ROW EXECUTE PROCEDURE key_rules_apply_rules();

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
        -- XXX avoids WHERE NOT EXISTS clause that doesn't work with keys_on_insert_delete_stale_computed
        IF NOT EXISTS (SELECT 1 FROM keys WHERE key = NEW.key) THEN
            INSERT INTO keys (key) SELECT NEW.key;
        END IF;
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

CREATE OR REPLACE FUNCTION current_data_delete() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM current_data
    WHERE key = NEW.key AND (NEW.deadline IS DISTINCT FROM OLD.deadline OR NEW.penalty_id IS DISTINCT FROM OLD.penalty_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER keys_on_update_delete_stale_current AFTER UPDATE ON keys
    FOR EACH ROW EXECUTE PROCEDURE current_data_delete();

CREATE OR REPLACE RULE raw_data_on_insert_delete_stale_current AS ON INSERT TO raw_data
    DO DELETE FROM current_data WHERE key = NEW.key AND username = NEW.username;

CREATE OR REPLACE RULE raw_data_on_delete_delete_stale_current AS ON DELETE TO raw_data
    DO DELETE FROM current_data WHERE key = OLD.key AND username = OLD.username;

CREATE TABLE IF NOT EXISTS current_computed (
    username TEXT NOT NULL REFERENCES users,
    key LTREE NOT NULL REFERENCES keys,
    ts TIMESTAMP(3) WITH TIME ZONE,
    value JSONB,
    penalty_applied TEXT REFERENCES penalties(penalty_id),
    created TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, key)
);
CREATE INDEX current_computed_key_gist ON current_computed USING gist(key);

-- XXX improve w/o breaking concurrent transactions?
CREATE OR REPLACE FUNCTION current_computed_ensure_foreign() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO users (username) VALUES (NEW.username) ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER current_computed_on_insert_ensure_foreign BEFORE INSERT ON current_computed
    FOR EACH ROW EXECUTE PROCEDURE current_computed_ensure_foreign();

CREATE OR REPLACE FUNCTION current_computed_ensure_key() RETURNS TRIGGER AS $$
BEGIN
    -- XXX WHERE NOT EXISTS clause doesn't work with keys_on_insert_delete_stale_computed!
    INSERT INTO keys (key) SELECT NEW.key WHERE NOT EXISTS (SELECT 1 FROM keys WHERE key = NEW.key);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER current_computed_on_insert_ensure_key BEFORE INSERT ON current_computed
    FOR EACH ROW EXECUTE PROCEDURE current_computed_ensure_key();

CREATE OR REPLACE FUNCTION current_computed_replace() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.username)); -- XXX otherwise concurrent inserts can fail
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
    base LQUERY,
    output LTREE NOT NULL,
    inputs LQUERY[] NOT NULL,
    compute TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS computations (
    base LTREE NOT NULL,
    output LTREE NOT NULL PRIMARY KEY REFERENCES keys,
    inputs LQUERY[] NOT NULL,
    compute TEXT NOT NULL,
    CHECK (base @> output)
);
CREATE INDEX computations_base_gist ON computations USING gist(base);
CREATE INDEX computations_output_gist ON computations USING gist(output);

CREATE OR REPLACE FUNCTION computation_rules_new_key() RETURNS TRIGGER AS $$
DECLARE
    new_computation computations%ROWTYPE;
BEGIN
    FOR new_computation IN
        SELECT prefix, prefix || output, array_agg(CASE WHEN prefix = '' THEN '' ELSE prefix::TEXT || '.' END || input ORDER BY ordinality)::LQUERY[], compute FROM
        (
            SELECT prefix, output, input, ordinality, compute FROM
            (
                SELECT subpath(NEW.key,0,split) AS prefix, subpath(NEW.key,split) AS suffix
                FROM generate_series(0,nlevel(NEW.key)-1) AS split
            ) AS splits
            JOIN computation_rules ON (CASE WHEN base IS NULL THEN prefix = '' ELSE prefix ~ base END AND suffix ? inputs),
            LATERAL unnest(inputs) WITH ORDINALITY AS input
        ) AS comp
        WHERE NOT EXISTS (SELECT 1 FROM computations WHERE output = prefix || comp.output)
        GROUP BY prefix, output, compute
    LOOP
        INSERT INTO computations VALUES (new_computation.*);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER keys_on_insert_insert_computations AFTER INSERT ON keys
    FOR EACH ROW EXECUTE PROCEDURE computation_rules_new_key();

CREATE OR REPLACE FUNCTION computation_rules_new_rule() RETURNS TRIGGER AS $$
DECLARE
    new_computation computations%ROWTYPE;
BEGIN
    FOR new_computation IN
        SELECT coalesce(NEW.base::TEXT, ''), coalesce(NEW.base || '.', '') || NEW.output::TEXT, NEW.inputs, NEW.compute WHERE cardinality(NEW.inputs) = 0
        UNION ALL
        SELECT prefix, (prefix || NEW.output)::TEXT, array_agg(CASE WHEN prefix = '' THEN '' ELSE prefix::TEXT || '.' END || input ORDER BY ordinality)::LQUERY[], NEW.compute FROM
        (
            SELECT DISTINCT subpath(key,0,split)::TEXT AS prefix, input, ordinality FROM
            (
                SELECT key, generate_series(0,nlevel(key)-1) AS split FROM
                keys
                WHERE key ~ ANY (SELECT (coalesce(NEW.base || '.', '') || unnest(NEW.inputs))::LQUERY)
            ) AS splits,
            LATERAL unnest(NEW.inputs::TEXT[]) WITH ORDINALITY AS input
            WHERE CASE WHEN NEW.base IS NULL THEN split = 0 ELSE subpath(key,0,split) ~ NEW.base END AND subpath(key,split) ? NEW.inputs
        ) AS comp
        GROUP BY prefix
    LOOP
        INSERT INTO computations VALUES (new_computation.*);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER computation_rules_on_insert_insert_computations AFTER INSERT ON computation_rules
    FOR EACH ROW EXECUTE PROCEDURE computation_rules_new_rule();

CREATE OR REPLACE FUNCTION computation_rules_delete_rule() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM computations WHERE output ~ (OLD.base::TEXT || '.' || OLD.output::TEXT)::LQUERY;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER computation_rules_on_delete_delete_computations AFTER DELETE ON computation_rules
    FOR EACH ROW EXECUTE PROCEDURE computation_rules_delete_rule();

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
    -- XXX WHERE NOT EXISTS clause doesn't work with keys_on_insert_delete_stale_computed!
    INSERT INTO keys (key) SELECT NEW.output WHERE NOT EXISTS (SELECT 1 FROM keys WHERE key = NEW.output);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER computations_on_insert_ensure_key BEFORE INSERT ON computations
    FOR EACH ROW EXECUTE PROCEDURE computations_ensure_key();

CREATE OR REPLACE FUNCTION new_key_delete_stale_computed() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM current_computed WHERE key IN (SELECT output FROM computations WHERE base @> NEW.key AND NEW.key ? inputs);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION new_data_delete_stale_computed() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM current_computed WHERE EXISTS(SELECT 1 FROM keys WHERE key = NEW.key AND active)
                                       AND key IN (SELECT output FROM computations WHERE base @> NEW.key AND NEW.key ? inputs)
                                       AND username = NEW.username;
    INSERT INTO precompute_queue
    SELECT NEW.username, output FROM computations WHERE EXISTS(SELECT 1 FROM keys WHERE key = NEW.key AND active)
                                                        AND base @> NEW.key AND NEW.key ? inputs
    ON CONFLICT DO NOTHING;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION old_data_delete_stale_computed() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM current_computed WHERE EXISTS(SELECT 1 FROM keys WHERE key = OLD.key AND active)
                                       AND key IN (SELECT output FROM computations WHERE base @> OLD.key AND OLD.key ? inputs)
                                       AND username = OLD.username;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER keys_on_insert_delete_stale_computed AFTER INSERT ON keys
    FOR EACH ROW WHEN (NEW.active) EXECUTE PROCEDURE new_key_delete_stale_computed();

CREATE TRIGGER keys_on_update_delete_stale_computed AFTER UPDATE ON keys
    FOR EACH ROW WHEN (NEW.active <> OLD.active) EXECUTE PROCEDURE new_key_delete_stale_computed();

CREATE OR REPLACE FUNCTION old_key_delete_stale_computed() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM current_computed WHERE key in (SELECT output FROM computations WHERE base @> OLD.key AND OLD.key ? inputs);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER keys_on_delete_delete_stale_computed AFTER DELETE ON keys
    FOR EACH ROW WHEN (OLD.active) EXECUTE PROCEDURE old_key_delete_stale_computed();

CREATE TRIGGER raw_data_on_insert_delete_stale_computed AFTER INSERT ON raw_data
    FOR EACH ROW EXECUTE PROCEDURE new_data_delete_stale_computed();

CREATE TRIGGER current_data_on_insert_delete_stale_computed AFTER INSERT ON current_data
    FOR EACH ROW EXECUTE PROCEDURE new_data_delete_stale_computed();

CREATE TRIGGER current_data_on_delete_delete_stale_computed AFTER DELETE ON current_data
    FOR EACH ROW EXECUTE PROCEDURE old_data_delete_stale_computed();

CREATE TRIGGER current_computed_on_insert_delete_stale_computed AFTER INSERT ON current_computed
    FOR EACH ROW EXECUTE PROCEDURE new_data_delete_stale_computed();

CREATE TRIGGER current_computed_on_delete_delete_stale_computed AFTER DELETE ON current_computed
    FOR EACH ROW EXECUTE PROCEDURE old_data_delete_stale_computed();

CREATE OR REPLACE FUNCTION new_computation_delete_stale_computed() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM current_computed WHERE key IN (
        WITH RECURSIVE all_computations AS (
            SELECT NEW.output UNION ALL SELECT c.output FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION old_computation_delete_stale_computed() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM current_computed WHERE key IN (
        WITH RECURSIVE all_computations AS (
            SELECT OLD.output UNION ALL SELECT c.output FROM computations c, all_computations a WHERE a.output ? c.inputs
        ) SELECT output FROM all_computations
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER computations_on_insert_delete_stale_computed AFTER INSERT ON computations
    FOR EACH ROW EXECUTE PROCEDURE new_computation_delete_stale_computed();

CREATE TRIGGER computations_on_update_delete_stale_computed AFTER UPDATE ON computations
    FOR EACH ROW EXECUTE PROCEDURE new_computation_delete_stale_computed();

CREATE TRIGGER computations_on_delete_delete_stale_computed AFTER DELETE ON computations
    FOR EACH ROW EXECUTE PROCEDURE old_computation_delete_stale_computed();

CREATE UNLOGGED TABLE IF NOT EXISTS precompute_queue (
    username TEXT NOT NULL REFERENCES users,
    key LTREE NOT NULL REFERENCES keys,
    PRIMARY KEY (username, key)
);
CREATE INDEX precompute_queue_key_gist ON precompute_queue USING gist(key);

CREATE OR REPLACE RULE current_computed_on_delete_queue_precompute AS ON DELETE TO current_computed
    DO INSERT INTO precompute_queue VALUES (OLD.username, OLD.key) ON CONFLICT DO NOTHING;

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
    SELECT users.*, keys.*, penalty_description, penalize, raw_data, computations.*,
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
        SELECT username, key, ts, value, penalty_applied, created, FALSE AS raw, TRUE AS computed FROM current_computed
    ) combined USING (key)
;

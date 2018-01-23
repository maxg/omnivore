-- assert
CREATE OR REPLACE FUNCTION assert(bool BOOLEAN, OUT _ BOOLEAN) AS $$ BEGIN
    IF NOT bool THEN RAISE 'assert failed' USING ERRCODE = 'AFAIL'; END IF;
END $$ LANGUAGE plpgsql;

-- assert with failure message
CREATE OR REPLACE FUNCTION assert(bool BOOLEAN, message TEXT, OUT _ BOOLEAN) AS $$ BEGIN
    IF NOT bool THEN RAISE 'assert failed: %', message USING ERRCODE = 'AFAIL'; END IF;
END $$ LANGUAGE plpgsql;

-- current timestamp
CREATE OR REPLACE FUNCTION t() RETURNS TIMESTAMP AS $$ BEGIN
    RETURN CURRENT_TIMESTAMP(3);
END $$ LANGUAGE plpgsql;

-- timestamp in the past
CREATE OR REPLACE FUNCTION t_minus(amount INTERVAL) RETURNS TIMESTAMP AS $$ BEGIN
    RETURN CURRENT_TIMESTAMP(3) - amount;
END $$ LANGUAGE plpgsql;

-- timestamp in the future
CREATE OR REPLACE FUNCTION t_plus(amount INTERVAL) RETURNS TIMESTAMP AS $$ BEGIN
    RETURN CURRENT_TIMESTAMP(3) + amount;
END $$ LANGUAGE plpgsql;

INSERT INTO staff VALUES ('staffer');

INSERT INTO agents VALUES ('tester', '-----BEGIN PUBLIC KEY-----
MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAKcrqJRD+MG2vmahVg3C///FWMMXZypIXiwMyutRfhyQ6UPTJdfUFKafUfQm5Nh5g54O+D2Xk/SJddLXHVKrXWkCAwEAAQ==
-----END PUBLIC KEY-----', '{ "test.*" }', '{ "test.*", "extra.*" }');

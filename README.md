Omnivore
========

**Eats records & grades**


Development
-----------

Open in dev container.

Run: `npm install`

Fill in `config/env-development.js` following the example.

Run `bin/serve` to start the web server.

Use `bin/test-{db,node}` to run the tests.


Production
----------

`bin/backup` — `pg_dump` all databases to the `backup` directory

`bin/restore` — run with the relative path to a backup directory to drop and `pg_restore` that database

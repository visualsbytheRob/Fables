# Rollback Runbook (F970)

If an upgrade breaks Fables and you need to roll back to a previous version.

## Scenario 1: Server won't start ("schema version X is newer than binary supports")

This happens when you rolled back the code but the DB already has newer
migrations applied.

### Option A: Restore from backup (safest)

```bash
# 1. Find your most recent pre-upgrade backup:
ls -lt ~/.fables/backups/*.fablesbak | head -5

# 2. Stop the server.
#    macOS:  launchctl stop com.fables.server
#    Linux:  sudo systemctl stop fables

# 3. Restore (via API while server is briefly running with old code,
#    or manually):
node -e "
  import('./apps/server/dist/services/backup.js').then(async m => {
    const { openDb } = await import('./apps/server/dist/db/connection.js');
    const db = openDb(process.env.HOME + '/.fables');
    await m.restoreBackup(db, process.env.HOME + '/.fables', '/path/to/backup.fablesbak');
    db.close();
    console.log('done');
  });
"

# 4. Restart the server.
```

### Option B: Point to a different data directory

```bash
# Keep the current DB intact; start fresh in a new dir.
DATA_DIR=~/.fables-v2 node apps/server/dist/server.js
```

### Option C: Manual DB rollback (advanced)

SQLite does not support rolling back individual migrations. To undo migrations:

1. Make a full copy of the database: `cp ~/.fables/fables.sqlite ~/.fables/fables-pre-rollback.sqlite`
2. Use `sqlite3` to DROP the tables/columns added by the unwanted migrations.
3. Remove the migration rows: `DELETE FROM applied_migrations WHERE id IN (15, 16);`
4. Restart the server.

This is error-prone; prefer Option A when possible.

---

## Scenario 2: Data corruption after upgrade

1. Stop the server immediately to prevent further writes.
2. Check integrity: `pnpm db:check`
3. If corrupted, restore from the most recent verified backup.
4. File a bug at https://github.com/robmcd/fables/issues with the error output.

---

## Scenario 3: Reverting to a previous git commit

```bash
git log --oneline -20        # find the last good commit
git checkout <commit-hash>   # detach HEAD to that commit
pnpm install && pnpm build   # rebuild at that version
```

Note: if the DB schema is ahead of the rolled-back code, see Scenario 1 above.

---

## Preventing future incidents

- Enable the nightly backup job (on by default).
- Check backup status: `curl localhost:4870/api/v1/backup/status`
- Run `pnpm upgrade-fables` from the repo root for guided upgrades that
  include a pre-migration backup step.

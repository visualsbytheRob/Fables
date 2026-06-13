# Disaster Recovery (F959)

Your machine died, was lost, or you're migrating to a new one. Here's how to
restore Fables with zero data loss (assuming backups were running).

## Prerequisites

- A `.fablesbak` backup archive (from `~/.fables/backups/` on the old machine,
  or from an external backup).
- Node.js >= 22 on the new machine.
- `pnpm` installed (`corepack enable`).

## Step-by-step

### 1. Clone and build Fables

```bash
git clone https://github.com/robmcd/fables.git ~/fables
cd ~/fables
node scripts/install.mjs
```

### 2. Copy your backup archive to the new machine

```bash
# From old machine (adjust path):
scp ~/.fables/backups/fables-*.fablesbak newmachine:~/fables-backup.fablesbak

# Or from Tailscale:
scp old-machine.tailnet-name.ts.net:~/.fables/backups/fables-*.fablesbak .
```

### 3. Start Fables briefly to restore

The restore command needs the server running (just long enough to trigger restore).

```bash
# Terminal 1: Start server
NODE_ENV=production node apps/server/dist/server.js &

# Terminal 2: Trigger restore
curl -X POST http://localhost:4870/api/v1/backup/restore \
  -H 'Content-Type: application/json' \
  -d '{"archivePath": "/path/to/fables-backup.fablesbak"}'
```

### 4. Restart the server

```bash
# Kill the background server
pkill -f 'fables/apps/server'

# Restart cleanly
node scripts/install.mjs    # also configures autostart if desired
```

### 5. Verify

```bash
curl http://localhost:4870/api/v1/health
curl http://localhost:4870/api/v1/debug/stats
```

### 6. Reconnect your iPhone

- Open `http://localhost:4870` (or your ts.net URL after re-running tailscale serve).
- Your PWA should sync automatically on reconnect.

---

## If you have no backup

If the backup job was not running, you may be able to recover data from:

1. **Git history** — if you ever committed `.fables/fables.sqlite` (not recommended).
2. **Time Machine / Time Capsule** — macOS automatic backups.
3. **iPhone IDB** — the IndexedDB local store on your phone may have a recent
   copy of your notes. Export from Settings → Data → Export IDB Snapshot.

---

## Enable backups going forward

```bash
# Check current status:
curl http://localhost:4870/api/v1/backup/status

# Trigger a manual backup now:
curl -X POST http://localhost:4870/api/v1/backup/run

# The nightly backup job starts automatically 5 minutes after each server boot.
```

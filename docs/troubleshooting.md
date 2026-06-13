# Troubleshooting Fables

This guide covers common issues and their fixes. For a detailed architecture overview, see `docs/architecture.md`. For Tailscale setup, see `docs/tailscale.md`.

---

## Server & Setup

### Server won't start / "port in use"

Port 4870 (the default) is already listening.

**Fix:**
```bash
# Change the port
pnpm dev --port 4871

# Or find which process is using 4870
lsof -i :4870

# Check port availability
pnpm doctor
```

### "Cannot find module @fables/core"

The workspace packages are not installed or built.

**Fix:**
```bash
cd /path/to/Fables
pnpm install
pnpm build
```

### Server crashes on startup / "ENOENT: no such file or directory, open '~/.fables'"

Data directory doesn't exist or isn't writable.

**Fix:**
```bash
# Ensure ~/.fables exists and is writable
mkdir -p ~/.fables
chmod 755 ~/.fables

# Or specify a custom data dir
pnpm dev --data-dir /tmp/fables-test
```

### Migrations failed / "database is locked"

SQLite WAL is stuck or another process is accessing the db.

**Fix:**
```bash
# Close all Fables instances
killall node

# Remove the WAL files (they will be recreated)
rm ~/.fables/fables.db-wal ~/.fables/fables.db-shm

# Restart
pnpm dev
```

### "SyntaxError: Unexpected token" in a .fable file

The Forge parser encountered invalid syntax.

**Fix:**
1. Open the story in the web app.
2. The **Problems** panel lists all diagnostics with line numbers and suggestions.
3. Consult `docs/forge/spec.md` for language syntax rules, or open the tutorial.

---

## Tailscale & Phone Access

### Cert not ready / "Your connection is not private" on iPhone

Tailscale's certificate is still being issued.

**Fix:**
1. Refresh the page a few times. The cert usually becomes available within 10 seconds.
2. If it persists, restart Tailscale on your machine:
   ```bash
   sudo tailscale down
   sudo tailscale up
   ```
3. Verify your machine is on the tailnet:
   ```bash
   tailscale ip -4
   ```
   Should print something like `100.x.x.x`.

### Can't reach the server from iPhone / "Cannot connect to server"

The device isn't on your tailnet, or the server isn't running.

**Fix:**
1. **Tailscale running on your machine?**
   ```bash
   tailscale status
   ```
   Should show "Logged in" and your tailnet IP. If not:
   ```bash
   sudo tailscale up
   ```

2. **Tailscale on iPhone?**
   Open the Tailscale app and ensure it's toggled **On**. Your machine should appear in the device list.

3. **Server running?**
   ```bash
   pnpm dev
   ```
   Should print a banner with the port and data dir.

4. **Correct URL?**
   After `tailscale serve --bg 4870`, Tailscale prints the URL. Paste it exactly into Safari on iPhone.

### PWA won't install / says "Unsupported"

PWAs require HTTPS. Localhost doesn't work; only Tailscale's `ts.net` domain triggers the install prompt.

**Fix:**
1. Ensure you're accessing via `https://mymachine.mytailnet.ts.net` (not `localhost`).
2. Clear Safari cache: **Settings > Safari > Clear History and Website Data**.
3. Try in a fresh Safari window (not a tab in an existing one).
4. Ensure you're on **iOS 14 or later**.

### Serve command exited / "tailscale serve is not responding"

The serve process crashed or timed out.

**Fix:**
```bash
# Reset and restart
tailscale serve --reset
tailscale serve --bg 4870
```

---

## Sync & Offline

### Offline indicator shows pending ops that won't clear

Sync is stuck (network error or server unreachable).

**Fix:**
1. **Check connectivity:** toggle Tailscale off and back on.
2. **Check server logs:** `pnpm dev` terminal should show sync errors.
3. **Check sync health:** in app **Settings > Sync Health** panel shows last sync time and error history.
4. **Force reconnect:** pull down on a list view to trigger manual sync.
5. **Last resort:** in **Settings**, tap **Wipe & Repair** IndexedDB. This clears local cache; data refills on next successful sync.

### Conflicts during sync / "Conflicting changes detected"

Two devices edited the same note offline and now the server must reconcile.

**Fix:**
1. The app shows a **Conflict Review** panel with side-by-side comparison.
2. You can:
   - **Keep mine:** use your version (discard server changes).
   - **Keep theirs:** use the server version (discard your changes).
   - **Merge:** manual three-way merge (if applicable for note bodies).
   - **Keep both:** creates a conflict-copy note; you manually combine them.
3. Pick one and confirm. The conflict is resolved.
4. **Why this happened:** sync uses Lamport clocks to order operations. If two devices wrote the same field at different times, the later timestamp wins. If timestamps are equal, device ID breaks the tie deterministically. Conflicts surface when the merge isn't clean.

### Data looks different on phone vs desktop

Sync may be running on different schedules.

**Fix:**
1. On the phone, **pull down** on a list to manually trigger sync.
2. Wait for the offline indicator to show "synced" (no pending ops).
3. On desktop, click the sync icon or wait for background sync.
4. If one device has unsaved drafts, they won't sync until you save them.

### IndexedDB is huge / "Storage quota exceeded"

Your cached data is taking up device storage.

**Fix:**
1. In **Settings > Storage**, check what's cached.
2. Unpin notes/notebooks you don't need offline: tap the pin icon on a note to toggle offline caching.
3. **Clear attachments cache:** attachments are cached separately. Tap **Clear** to remove cached images/PDFs.
4. Last resort: **Wipe & Repair** IndexedDB (clears everything, refills on next sync).

---

## Search & Indexing

### Search returns no results / "No results found"

Full-text search (FTS) index may be out of sync or corrupt.

**Fix:**
1. Try a different query (shorter, without special characters).
2. Toggle search mode: **keyword** vs **semantic** (semantic requires embeddings to be available).
3. In **Settings > Debug**, tap **Rebuild Search Index**. This re-indexes all notes in the database.
4. If search is still broken, check server logs for indexing errors.

### Embeddings unavailable / "Semantic search disabled"

The embeddings model didn't download or is incompatible.

**Fix:**
1. Embeddings require an internet connection to download the model on first use.
2. If you're offline, semantic search falls back to keyword search (no error).
3. On first connect, the app downloads a ~30MB model (may take 1–2 minutes).
4. If the download fails, check your internet connection.
5. To retry: in **Settings > Debug**, tap **Clear Embeddings Cache** and re-open search.

---

## Migrations & Upgrades

### Database is a future version / "Cannot open newer database"

You cloned the repo on a newer machine that has a newer schema version.

**Fix:**
1. **Do not force-open it.** The newer schema may break the older app.
2. Ensure both machines are running the same Fables version.
3. On the older machine, pull the latest code:
   ```bash
   git pull origin main
   pnpm install
   ```
4. Restart `pnpm dev`.

### Migrations failed / "migration XXX failed"

A database migration didn't apply cleanly.

**Fix:**
1. Check the error message in the server log.
2. **Backup first:**
   ```bash
   pnpm db:backup
   ```
3. **Check the migration:**
   Open `apps/server/src/db/migrations/NNN-*.ts` to see what it's doing.
4. **Manual fix:** if the migration is stuck, you may need to manually run SQL:
   ```bash
   sqlite3 ~/.fables/fables.db
   ```
5. **Rollback:** restore from the backup:
   ```bash
   cp ~/.fables/fables.db.backup ~/.fables/fables.db
   ```

### App version mismatch / "Schema negotiation failed"

An old client is talking to a new server (or vice versa) with incompatible schemas.

**Fix:**
1. Ensure both server and web app are from the same Fables commit:
   ```bash
   git status
   git log -1
   ```
2. Rebuild:
   ```bash
   pnpm clean
   pnpm install
   pnpm build
   ```
3. Restart both server and browser.

---

## Stories & Compilation

### Story won't compile / "Syntax errors in code"

The Forge compiler found issues in your `.fable` source.

**Fix:**
1. In the **Author** workspace, the **Problems** panel shows all errors.
2. Click an error to jump to that line in the editor.
3. Hover over the red squiggle to see the diagnostic code (e.g., `FORGE001`).
4. Consult the diagnostic catalog in `docs/forge/spec.md` (appendix) for what it means.
5. Common issues:
   - Missing knot headers (`===`)
   - Undefined divert targets (`-> missing_knot`)
   - Type mismatches in expressions (`"text" + 5` is invalid)
   - Unmatched brackets or nested choice depth

### Story plays but ends abruptly / "Unexpected end of story"

The story executed an `END` marker or ran out of choice branches.

**Fix:**
1. In the **Playtest** pane, check your choices. Did you explore all branches?
2. Check the story's scene graph to see if there are unreachable knots (shown in red).
3. Re-read the final knot to see if it explicitly ends with `END` or if all branches have `->` diverts.

### Compiled story is huge / "Large bytecode blob"

The story has too many choices or text variants, inflating the bytecode.

**Fix:**
1. Use `INCLUDE` to split large stories into multiple files.
2. Avoid deeply nested choices (nest ≤4 levels deep).
3. Re-use common passages with tunnels (`->` tunnel calls, `<-` return).

### Entity bindings return wrong values / "@hero.health shows old data"

Knowledge state is snapshot at story start, not live.

**Fix:**
1. In **Forge**, binding mode is either snapshot (F644) or live (changes each turn).
2. Check the story settings: **Live Bindings** toggle.
3. If live bindings are off, the story took a snapshot of all entities at play start. Changes to entities during the playthrough won't be reflected.
4. If live bindings are on, beware: rewinding saves won't work reliably (F647).

---

## UI & Mobile

### App is unresponsive / hanging on load

Something is blocking the main thread.

**Fix:**
1. Wait 10 seconds; large data loads take time.
2. Force refresh: **Cmd+Shift+R** (desktop) or close and reopen app (mobile).
3. Check network tab in dev tools; is a request hanging?
4. If the app stays hung, try wipe & repair IndexedDB:
   ```
   Settings > Storage > Wipe & Repair
   ```

### Bottom tab bar is missing on phone

Layout didn't respond to viewport width change.

**Fix:**
1. Verify you're on a phone-width viewport (≤600px).
2. Force layout recalculation: rotate the device, or close and reopen.

### Keyboard doesn't dismiss on mobile / editor stays focused

iOS keyboard avoidance may have a bug.

**Fix:**
1. Tap outside the editor (on the story text area).
2. Scroll up in the editor; the toolbar will float above the keyboard.
3. Tap the keyboard dismiss button (⌘ on iOS).

### Haptics not working / no vibration on choice

The Haptic Engine API may not be available.

**Fix:**
1. Haptics only work on iOS devices with a Haptic Engine (iPhone 6s+).
2. Ensure Haptics are enabled: **Settings > Sounds & Haptics**.
3. Check Fables settings: **Accessibility > Haptics** toggle.

---

## Advanced: Debug Tools

### Enable verbose logging

In **Settings > Debug**, toggle **Log Level** to `debug` or `trace`. Server logs will be much more detailed.

### Check database integrity

```bash
pnpm db:check
```

Runs `PRAGMA integrity_check` on the SQLite database. Should print "ok".

### View sync protocol details

In **Settings > Sync Health**, expand each device to see:
- Last sync time
- Pending ops count
- Error history
- Device clock info

### Export diagnostics

In **Settings > Debug**:
1. Tap **Export Debug Bundle** to save a JSON file with logs, config, and stats.
2. Share this with maintainers to debug issues faster.

---

## When All Else Fails

### Hard reset (clear everything, start fresh)

```bash
# Stop the server
killall node

# Backup first
cp -r ~/.fables ~/.fables.backup

# Clear data
rm -rf ~/.fables/fables.db*
rm -rf ~/.fables/attachments
rm -rf ~/.fables/logs

# Restart
pnpm dev
```

The app will recreate an empty database on start.

### Reach out

If you're stuck:
1. Check GitHub issues: search for your error or symptom.
2. Enable debug logging and export the debug bundle.
3. Open an issue with:
   - Fables version (`git log -1`)
   - OS and Node version
   - Error logs (from Settings > Debug > Export)
   - Steps to reproduce

---

**Last updated:** Day 9. This guide covers known issues through feature set F801–F900 (offline, sync, PWA, Tailscale).

# Security FAQ (F1298)

**Is my data sent anywhere?**
No. Fables is local-first: everything lives in `~/.fables` on your machine. There
is no analytics, telemetry, or cloud sync to a third party. Multi-device use goes
over your own Tailscale network.

**Do I have to use the vault?**
No. It's off by default and the app is fully functional without it. Turn it on in
Settings → Encrypted Vault if your notes are sensitive.

**What happens if I forget my passphrase?**
Your data is unrecoverable. Only you hold the key; there is no reset and no
backdoor — that's the guarantee that makes the encryption meaningful. Save your
recovery codes when you create the vault.

**What exactly is encrypted?**
With the vault on: note titles and bodies, attachment files, and exported
backups are ciphertext on disk. Note ids, timestamps, and notebook structure stay
plaintext so the app can list and sort without unlocking — they reveal no content.

**Can a thief who steals my laptop read my notes?**
Not if the vault is on and locked. They'd get scrambled bytes. (If they steal it
while it's unlocked and logged in, that's a different problem — encryption
protects data at rest, not an already-open screen.)

**Can search still find my notes when the vault is on?**
Encrypted notes aren't found by the on-disk search index yet (it only sees
ciphertext). A post-unlock in-memory search index is planned (F1213). Plaintext
(no-vault) search is unaffected.

**Why can't search just read them — the app has the key when unlocked?**
It can, and the planned in-memory index will use exactly that. It's a build-order
thing, not a limitation of the design.

**What algorithms do you use?**
Argon2id for the passphrase, XChaCha20-Poly1305 for encryption, SHA-256 for the
tamper-evident audit log. See `crypto-design.md` and `security-model-experts.md`.

**Is changing my passphrase slow if I have lots of notes?**
No — it's instant regardless of vault size. Changing the passphrase re-wraps a
single key; it never re-encrypts your content.

**Can a malicious URL in the clipper reach my internal network?**
No. The clipper refuses to fetch private, loopback, link-local, or cloud-metadata
addresses, and resolves DNS first so a public hostname pointing at an internal IP
is also blocked.

**Can plugins read my secrets?**
Plugins run sandboxed with capability-gated access. Encrypted/secret content is
not handed to plugins.

**How do I know the security log wasn't tampered with?**
Each entry is hash-chained to the one before it; `GET /vault/audit` returns a
verification that pinpoints the first altered or deleted row, if any.

**What should I actually do?**
Turn the vault on if you need it, save your recovery codes, enable auto-lock, and
keep encrypted backups somewhere safe.

# Your Fables Security, in Plain Language (F1294)

No jargon. This explains what Fables protects, what it can't, and what you should
do — written for the person using the app, not a security engineer. (There's a
companion deep-dive for experts in `security-model-experts.md`.)

## The one-sentence version

Fables runs on **your own computer** and keeps your data there; if you turn on
the **vault**, your notes are scrambled on disk so that someone who steals the
files can't read them — but only **you** hold the key, so if you forget your
passphrase, the data is gone for good.

## Where your stuff lives

Everything — notes, stories, attachments — lives in a folder on your machine
(`~/.fables`). Nothing is sent to any company's cloud. When you use it on your
phone, it talks to your own computer over your private Tailscale network, not
over the public internet. So the first and biggest protection is simply: **your
data never leaves your control.**

## The vault: an optional lock for the whole app

The vault is **off by default** — the app works fully without it. When you turn
it on (Settings → Encrypted Vault), you choose a passphrase. From then on:

- **On disk, your notes are scrambled** (encrypted). If your laptop is stolen or
  someone copies the `~/.fables` folder, they get gibberish, not your words.
- **To use the app, you unlock it** with your passphrase. While unlocked, the app
  can read your notes normally. When you lock it (manually, after idle time, or
  with the panic button), the key is wiped from memory and the screen shows
  nothing sensitive.
- **Only you can unlock it.** Your passphrase is never written down anywhere by
  the app, never sent anywhere. That's the whole point — and the catch.

## The honest catch: there is no "forgot password"

Because only you hold the key, **there is no recovery if you forget your
passphrase.** No reset email, no backdoor, no support line that can let you back
in. That's not a missing feature — it's the guarantee. If a company _could_ reset
it, so could an attacker (or a court order).

So, two rules:

1. **Save your recovery codes** when you create the vault. Put them somewhere safe
   and separate (a password manager, a printed copy in a drawer).
2. **Pick a passphrase you won't forget but others can't guess** — a memorable
   phrase of several words beats a short complex password.

## What Fables protects you from

- Someone who **steals your computer or a backup** and tries to read your notes.
- Apps or scripts trying to reach **internal addresses** through Fables (it
  refuses to fetch private/internal URLs).
- **Tampering with the security log** — the app keeps a tamper-evident record of
  vault events that detects if anyone edits or deletes entries.
- **Accidental leaks** — secrets aren't shown when locked, copied secrets clear
  from the clipboard, and the app sends no analytics anywhere.

## What it does NOT protect you from

- **A forgotten passphrase** (covered above — the data is unrecoverable).
- **Malware already running on your unlocked computer.** While the vault is
  unlocked, the app can read your notes, and so could malware running as you.
  Keep your machine healthy.
- **Someone watching you type your passphrase**, or a compromised device. The
  encryption protects data at rest, not a screen you've already unlocked.

## What you should do

- Turn the vault on if your notes are sensitive; leave it off if convenience
  matters more — your choice, and you can decide later.
- Save your recovery codes the moment you create the vault.
- Use auto-lock so an unattended screen locks itself.
- Keep regular backups (the app can make encrypted ones) somewhere safe.

That's it. Local-first, you hold the key, and the app is honest about the
trade-off that comes with truly private encryption.

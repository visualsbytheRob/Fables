# Secrets Scan (F950)

## Policy

No secrets are ever committed to the Fables repository. The `.gitignore` excludes
`.env`, `*.pem`, `*.key`, and common secret file patterns.

## Pre-commit: git-secrets (recommended)

Install `git-secrets` to scan every commit for patterns like AWS keys, etc.:

```bash
brew install git-secrets          # macOS
git secrets --install             # installs hooks in this repo
git secrets --register-aws        # adds AWS key patterns
```

## Pre-push: trufflehog

For a more thorough scan including history:

```bash
pip install trufflehog
trufflehog git file://. --since-commit HEAD~20
```

## Scanning commit history

If you suspect a secret was committed in the past:

```bash
trufflehog git file://. --json | jq '.SourceMetadata.Data.Git.commit,.Detectors[].Name'
```

## What to do if a secret leaks

1. **Rotate the secret immediately** — assume it is compromised.
2. Remove it from Git history:
   ```bash
   git filter-repo --sensitive-data-removal-file secrets.txt
   git push --force-with-lease origin main
   ```
3. Audit access logs for the leaked credential.
4. If the secret is a `FABLES_TOKEN`, generate a new one:
   ```bash
   node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update(crypto.randomUUID()).digest('hex'))"
   ```
   Set the new value in your environment and restart the server.

## CI integration

Add to your CI pipeline (`.github/workflows/ci.yml`):

```yaml
- name: Secrets scan
  uses: trufflesecurity/trufflehog@main
  with:
    path: ./
    base: ${{ github.event.repository.default_branch }}
    head: HEAD
```

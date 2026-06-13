# Serving Fables on Your iPhone via Tailscale

**Read this guide to access your Fables vault on your iPhone as a progressive web app (PWA) over a secure, encrypted connection.**

## What is Tailscale and why use it?

[Tailscale](https://tailscale.com) is a zero-config VPN based on WireGuard. It connects your devices over an encrypted mesh network without exposing them to the public internet. For Fables:

- **Private**: Your vault stays on your machine; Tailscale just tunnels access from your phone.
- **HTTPS required for PWA**: Progressive web apps (which enable offline reading and home-screen installation) require a valid TLS certificate. Tailscale provides this automatically via its `ts.net` domain with certificates signed by their trusted CA.
- **Seamless on your tailnet**: Works on Wi-Fi or cellular, no port forwarding, no dynamic DNS fiddling.

**Why NOT public internet?** Tailscale Funnel (their option for public sharing) would expose your vault to anyone with the link. Fables is designed for a single user; we keep it private by default (see troubleshooting below).

## Prerequisites

- **Mac or Linux with Fables running** (the machine serving your vault). Windows support pending; let the user run Fables on a Mac/PC in the meantime.
- **Tailscale installed on both your Mac/PC and iPhone**, signed into the same account.
- **iPhone with iOS 14+** and Safari.

## Installation & Setup

### 1. Install Tailscale on your main machine

Download [Tailscale for Mac](https://tailscale.com/download/mac) or [Linux](https://tailscale.com/download/linux).

```bash
# Mac (via Homebrew)
brew install tailscale

# Linux (Ubuntu/Debian example — see tailscale.com/download for your distro)
curl -fsSL https://tailscale.com/install.sh | sh
```

Start the Tailscale daemon and log in:

```bash
sudo tailscale up
```

A browser will open; sign in with your Tailscale account. Once complete, run:

```bash
tailscale ip -4
```

You should see your machine's IP on the tailnet (e.g., `100.x.x.x`).

### 2. Install Tailscale on your iPhone

Download **Tailscale** from the App Store and sign in with the same account. Turn it **On**. You should see your machine appear in the device list.

### 3. Start Fables and expose port 4870 over Tailscale

On your Mac/PC, start Fables normally:

```bash
pnpm dev
```

Fables defaults to port `4870`. Once it's running, expose that port with:

```bash
tailscale serve --bg 4870
```

Tailscale will print something like:

```
Available at:
  https://mymachine.myname.ts.net
```

**Save that URL.** That's your iPhone's link to Fables.

### 4. Open Fables on your iPhone and install the PWA

On your iPhone:

1. Open Safari.
2. Paste the URL from step 3 (e.g., `https://mymachine.myname.ts.net`).
3. Fables should load. Tap the **Share** button (square with arrow).
4. Scroll down and tap **Add to Home Screen**.
5. Name it "Fables" (or whatever you like) and tap **Add**.

Fables is now on your home screen as a standalone app icon.

### 5. Verify offline access

The PWA stores its app shell (HTML, CSS, JavaScript) offline via a service worker. To test:

1. Open Fables from your home screen.
2. In Settings on your iPhone, toggle Tailscale **Off** to simulate no connection.
3. The app should still load, and you can read notes and stories that were cached.
4. Toggle Tailscale back **On** to sync and fetch new data.

---

## Troubleshooting

### Cert not ready / "Your connection is not private"

When you first run `tailscale serve`, the certificate is issued by Tailscale's CA. If you see a cert warning on your iPhone:

- Refresh the page a few times. The cert usually becomes available within 10 seconds.
- If it persists, restart Tailscale on your machine: `sudo tailscale down && sudo tailscale up`.

### Port 4870 is already in use

If you get "port in use" when starting Fables:

```bash
# Change the port (and serve the new port)
pnpm dev --port 4871
tailscale serve --bg 4871
```

Verify port availability with:

```bash
pnpm doctor
```

### PWA won't install or says "Unsupported"

PWAs require HTTPS. If you're testing on localhost, the app works as a website but won't install. **Only on Tailscale's `ts.net` domain does the PWA prompt appear.** If it still doesn't:

- Clear Safari cache: Settings > Safari > Clear History and Website Data.
- Ensure you're on iOS 14 or later.
- Try in a fresh Safari window (not a tab in an existing one).

### Can't reach the machine / "Cannot connect to server"

- **Tailscale not running on your PC**: `sudo tailscale status` should show "Logged in" and your tailnet IP.
- **Tailscale not on iPhone**: Open the Tailscale app and ensure it's toggled **On**.
- **Server crashed**: Check `pnpm dev` logs. The Fables startup banner shows the port and data directory.
- **Firewall blocking**: On Mac, check System Preferences > Security & Privacy > Firewall. Tailscale itself punches through; your local firewall shouldn't block the loopback interface.

### Serve stopped / `tailscale serve` is not responding

If `tailscale serve` exited unexpectedly:

```bash
# Stop and restart it
tailscale serve --reset
tailscale serve --bg 4870
```

---

## Why NOT Tailscale Funnel?

Tailscale Funnel opens a public URL (e.g., `mymachine.tail123456.ts.net`) accessible from anywhere without a tailnet account. **We do not enable it by default because:**

- **Vault exposure**: Fables is a personal knowledge OS. Your notes, stories, entities—everything is sensitive. Public internet access means anyone with the link can dump your vault if the link is shared or leaked.
- **No authentication yet**: Early Fables has no built-in login. Funnel + no auth = anyone can read or mutate your entire knowledge base.
- **Single-user design**: Fables is built for one person on one machine. Publishing it publicly is architecturally out of scope.

**If you later want to share a single story or read-only excerpt**: that is future work (likely a story-specific export or read token, not Funnel). For now, keep Fables on your tailnet.

---

## Advanced: Running Fables and Tailscale together in one command

Create `scripts/serve.sh` (future F882):

```bash
#!/bin/bash
set -e

PORT=${1:-4870}

# Start Fables in the background
pnpm dev --port "$PORT" &
FABLES_PID=$!

# Wait for the server to be ready
sleep 2

# Start Tailscale serve
echo "Exposing port $PORT via Tailscale..."
tailscale serve --bg "$PORT"

# Print the URL
TAILNET_NAME=$(tailscale status | grep "@" | awk '{print $1}' | sed 's/@//')
MACHINE_NAME=$(hostname)
echo ""
echo "✓ Fables is running at:"
echo "  https://$MACHINE_NAME.$TAILNET_NAME.ts.net"
echo ""
echo "Press Ctrl+C to stop."
wait $FABLES_PID
```

Then run:

```bash
bash scripts/serve.sh
```

---

## Next: Fresh phone onboarding in under 5 minutes

Once Tailscale and the PWA are installed, the onboarding is tight:

1. Tailscale On → machine appears.
2. Safari → paste URL → Share → Add to Home Screen.
3. Done. Your vault is on your phone.

See F890 for a checklist.

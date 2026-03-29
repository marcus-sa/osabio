# Sandbox Agent: OS-Level User Isolation

Running coding agents under a restricted OS user to prevent unauthorized filesystem access. Covers both Linux and macOS with the Sandbox Agent local provider.

## Why User Isolation

The Sandbox Agent local provider reuses your existing Claude Code installation and credentials. This is convenient but means the agent process inherits your full filesystem permissions — access to SSH keys, `.env` files, other repositories, browser profiles, etc.

Running the agent as a separate OS user is the simplest strong boundary: Unix permissions prevent access to anything the restricted user wasn't explicitly granted.

## Linux Setup

### 1. Create restricted user

```bash
sudo useradd -m -s /bin/bash claude-sandbox
```

### 2. Install tooling for the sandbox user

```bash
sudo -u claude-sandbox -i bash -c '
  # Install Claude Code
  npm i -g @anthropic-ai/claude-code@latest

  # Install Sandbox Agent
  curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh
'
```

### 3. Share Claude Code auth

The sandbox user needs access to your existing Claude Code authentication. Copy the auth directory:

```bash
sudo mkdir -p /home/claude-sandbox/.claude
sudo cp -R ~/.claude/ /home/claude-sandbox/.claude/
sudo chown -R claude-sandbox:claude-sandbox /home/claude-sandbox/.claude
```

No API keys are needed — Sandbox Agent's local provider reuses Claude Code's existing login session.

### 4. Clone the project

The sandbox user maintains its own repository. Normal git workflow — agent pushes, you pull.

```bash
sudo -u claude-sandbox -i bash -c '
  mkdir -p ~/work
  cd ~/work
  git clone git@github.com:yourorg/yourrepo.git
'
```

### 5. Start Sandbox Agent

```bash
sudo -u claude-sandbox -i sandbox-agent server \
  --host 127.0.0.1 \
  --port 2468 \
  --token my-secret-token
```

### 6. Connect from your application

```typescript
import SandboxAgent from "@anthropic-ai/sandbox-agent-sdk";

const agent = await SandboxAgent.connect("http://localhost:2468", {
  token: "my-secret-token",
});
const session = await agent.session.create({ agent: "claude" });
await session.prompt("Implement the rate limiter");
await session.destroy();
```

### Optional: NOPASSWD for convenience

Add to `/etc/sudoers` via `sudo visudo`:

```
marcus ALL=(claude-sandbox) NOPASSWD: ALL
```

### Optional: Network restriction (iptables)

Restrict which hosts the sandbox user can reach:

```bash
# Allow localhost (for Sandbox Agent API)
sudo iptables -A OUTPUT -m owner --uid-owner claude-sandbox \
  -d 127.0.0.1 -j ACCEPT

# Allow Anthropic API
sudo iptables -A OUTPUT -m owner --uid-owner claude-sandbox \
  -d api.anthropic.com -j ACCEPT

# Allow GitHub (for git push/pull)
sudo iptables -A OUTPUT -m owner --uid-owner claude-sandbox \
  -d github.com -j ACCEPT

# Block everything else
sudo iptables -A OUTPUT -m owner --uid-owner claude-sandbox -j DROP
```

### Optional: Resource limits (cgroups via systemd)

```bash
sudo systemd-run \
  --uid=claude-sandbox \
  --property=MemoryMax=4G \
  --property=CPUQuota=200% \
  -- sandbox-agent server --host 127.0.0.1 --port 2468
```

---

## macOS Setup

### 1. Create restricted user

```bash
sudo dscl . -create /Users/claude-sandbox
sudo dscl . -create /Users/claude-sandbox UserShell /bin/zsh
sudo dscl . -create /Users/claude-sandbox UniqueID 550
sudo dscl . -create /Users/claude-sandbox PrimaryGroupID 20
sudo dscl . -create /Users/claude-sandbox NFSHomeDirectory /Users/claude-sandbox
sudo mkdir -p /Users/claude-sandbox
sudo chown claude-sandbox:staff /Users/claude-sandbox
```

### 2. Install tooling for the sandbox user

```bash
sudo -u claude-sandbox -i bash -c '
  npm i -g @anthropic-ai/claude-code@latest
  curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh
'
```

### 3. Share Claude Code auth

```bash
sudo mkdir -p /Users/claude-sandbox/.claude
sudo cp -R ~/.claude/ /Users/claude-sandbox/.claude/
sudo chown -R claude-sandbox:staff /Users/claude-sandbox/.claude
```

### 4. Clone the project

```bash
sudo -u claude-sandbox -i bash -c '
  mkdir -p ~/work
  cd ~/work
  git clone git@github.com:yourorg/yourrepo.git
'
```

### 5. Start Sandbox Agent

```bash
sudo -u claude-sandbox -i sandbox-agent server \
  --host 127.0.0.1 \
  --port 2468 \
  --token my-secret-token
```

### Optional: NOPASSWD for convenience

```bash
# sudo visudo
marcus ALL=(claude-sandbox) NOPASSWD: ALL
```

---

## What This Prevents

- Agent cannot read your home directory (`~marcus/`)
- Agent cannot access SSH keys, API tokens, `.env` files outside its own home
- Agent cannot modify files in other repositories
- Agent cannot read browser profiles, credentials stores, or system configs
- File ownership makes any accidental escapes visible

## Known Limitations

| Concern | Linux | macOS |
|---------|-------|-------|
| Clipboard | Separate (X11/Wayland per-session) | Shared (system pasteboard) |
| `/tmp` isolation | Shared by default — set `TMPDIR` per-user | Automatic (`TMPDIR` is per-user) |
| Network restriction | `iptables --uid-owner` | `pf` firewall (less granular) |
| Resource limits | cgroups / `systemd-run` | Limited options |
| Bind mounts (read-only views) | Supported | Not available |
| Namespace isolation | `unshare` available | Not available |

## Auth Sync

When Claude Code's auth session refreshes, re-sync to the sandbox user:

```bash
# Linux
sudo cp -R ~/.claude/ /home/claude-sandbox/.claude/
sudo chown -R claude-sandbox:claude-sandbox /home/claude-sandbox/.claude

# macOS
sudo cp -R ~/.claude/ /Users/claude-sandbox/.claude/
sudo chown -R claude-sandbox:staff /Users/claude-sandbox/.claude
```

Consider a symlink or shared group for the `.claude` directory if re-syncing is frequent, but be aware this widens the trust boundary.

## Comparison to Alternatives

| Approach | File isolation | Network isolation | Setup complexity |
|----------|---------------|-------------------|------------------|
| OS user (this doc) | Unix permissions | Manual (iptables/pf) | Low |
| Docker container | Container boundary | Docker networking | Medium |
| E2B / Daytona | Full VM isolation | Provider-managed | Low (but hosted) |
| Linux namespaces | Kernel-level | Network namespace | High |

OS user isolation is the sweet spot for the local provider — minimal setup, strong filesystem boundary, and reuses existing Claude Code credentials without containerization overhead.

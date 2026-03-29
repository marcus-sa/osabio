# Four Forces Analysis: Osabio CLI Proxy Setup

## Primary Job: Automatic LLM Proxy Routing

| Force | Detail |
|-------|--------|
| **Push** (current frustration) | Must manually create `.claude/settings.local.json`, know the header format, know the proxy URL, and manage tokens — error-prone and undocumented |
| **Pull** (desired future) | Run `osabio init`, everything is wired. Every Claude Code session flows through Osabio automatically — policy enforcement, tracing, context injection |
| **Anxiety** (adoption concerns) | "Will this break my existing Claude Code setup?" / "What if the token expires mid-session?" / "Can I disable it easily?" |
| **Habit** (current behavior) | Using Claude Code directly against Anthropic API — no proxy, no shared context. Muscle memory of `claude` with no extra setup |

## Design Implications

- **Push mitigations**: Single command, zero manual config editing
- **Pull amplifiers**: Immediate value on first `claude` session post-setup (context injection visible)
- **Anxiety reducers**: Idempotent command, merge-not-overwrite for existing config, clear confirmation output showing what was configured
- **Habit bridges**: Zero behavior change after setup — `claude` command works identically, just routed through proxy

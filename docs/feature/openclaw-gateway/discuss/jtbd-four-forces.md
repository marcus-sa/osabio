# Four Forces Analysis — openclaw-gateway

## J1: Context-Aware Coding Session

```
                    PUSH                                    PULL
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "I copy-paste decisions from    │  │ "My agent knows the project     │
  │  Brain chat into my editor      │  │  decisions, constraints, and    │
  │  every session. Context is      │  │  learnings before I type a      │
  │  stale by the time I paste it." │  │  single character."             │
  └─────────────────────────────────┘  └─────────────────────────────────┘

                   HABIT                                   ANXIETY
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "I already use OpenClaw CLI     │  │ "Will the gateway add latency?  │
  │  and it works. MCP setup with   │  │  Will it break my existing      │
  │  brain init is 'good enough'."  │  │  OpenClaw workflow?"            │
  └─────────────────────────────────┘  └─────────────────────────────────┘
```

**Switch likelihood**: HIGH — Push is strong (daily pain), Pull is concrete (measurable context injection), Anxiety is addressable (zero additional latency per research), Habit is weak (MCP setup is already friction).

---

## J2: Zero-Config Agent Onboarding

```
                    PUSH                                    PULL
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "Every new agent needs          │  │ "Connect device, verify         │
  │  brain init, config.json,       │  │  Ed25519 challenge, auto-       │
  │  .mcp.json, CLAUDE.md. It's     │  │  register — working in          │
  │  20 minutes per agent."         │  │  seconds, not minutes."         │
  └─────────────────────────────────┘  └─────────────────────────────────┘

                   HABIT                                   ANXIETY
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "brain init works and I have    │  │ "Will auto-registration give    │
  │  a script for it."              │  │  agents too much access?         │
  │                                 │  │  What about authority scopes?"  │
  └─────────────────────────────────┘  └─────────────────────────────────┘
```

**Switch likelihood**: MEDIUM-HIGH — Push scales with team size (pain grows). Anxiety is real but addressable via RAR scopes and workspace admin controls.

---

## J3: Governed Agent Execution

```
                    PUSH                                    PULL
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "Agent autonomy is either       │  │ "Every agent action goes        │
  │  all-or-nothing. I can't        │  │  through intent evaluation,     │
  │  give agents autonomy without   │  │  policy checks, and budget      │
  │  giving up control."            │  │  enforcement — natively."       │
  └─────────────────────────────────┘  └─────────────────────────────────┘

                   HABIT                                   ANXIETY
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "I watch agent output manually  │  │ "What if the governance layer   │
  │  and kill sessions that look    │  │  adds latency or blocks         │
  │  wrong."                        │  │  legitimate agent work?"        │
  └─────────────────────────────────┘  └─────────────────────────────────┘
```

**Switch likelihood**: HIGH — Current habit (manual monitoring) doesn't scale. Brain's policy graph is deterministic and fast. Anxiety is mitigable via configurable authority tiers.

---

## J4: Native Trace Recording

```
                    PUSH                                    PULL
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "Agent traces are reconstructed │  │ "Every agent execution is a     │
  │  from proxy logs. I grep text   │  │  graph-native call tree I can   │
  │  dumps to understand what       │  │  traverse with a query."        │
  │  happened."                     │  │                                 │
  └─────────────────────────────────┘  └─────────────────────────────────┘

                   HABIT                                   ANXIETY
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "I use grep + jq on proxy       │  │ "Will the trace overhead slow   │
  │  logs. It works for debugging." │  │  down agent execution?"         │
  └─────────────────────────────────┘  └─────────────────────────────────┘
```

**Switch likelihood**: HIGH — Push is acute during incidents. Pull is transformative (graph queries vs grep). Trace recording is already native in Brain.

---

## J5: Real-Time Agent Streaming

```
                    PUSH                                    PULL
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "I submit work and wait. No     │  │ "See tokens streaming, file     │
  │  visibility until completion    │  │  changes appearing, approve     │
  │  or failure."                   │  │  exec requests in real time."   │
  └─────────────────────────────────┘  └─────────────────────────────────┘

                   HABIT                                   ANXIETY
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "I check terminal output in     │  │ "Will WebSocket connections     │
  │  the CLI. Good enough for       │  │  be stable? What about          │
  │  single-agent use."             │  │  reconnection?"                 │
  └─────────────────────────────────┘  └─────────────────────────────────┘
```

**Switch likelihood**: MEDIUM — Pull is strong for multi-agent scenarios. Anxiety around WS stability is legitimate and must be addressed in implementation (reconnection, heartbeat).

---

## J6: Multi-Agent Workspace Coordination

```
                    PUSH                                    PULL
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "Every agent I add makes        │  │ "Agents read/write to shared    │
  │  coordination worse. I'm the    │  │  graph. Adding agents improves  │
  │  integration layer."            │  │  coverage, not complexity."     │
  └─────────────────────────────────┘  └─────────────────────────────────┘

                   HABIT                                   ANXIETY
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "I relay context manually       │  │ "Will agents conflict? Will     │
  │  between agents. It's slow      │  │  they create contradictory      │
  │  but I control the flow."       │  │  decisions?"                    │
  └─────────────────────────────────┘  └─────────────────────────────────┘
```

**Switch likelihood**: HIGH — This is Brain's core value prop. Observer agent already detects contradictions. Anxiety is addressed by existing conflict detection.

---

## J7: Model Routing and Spend Control

```
                    PUSH                                    PULL
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "Each agent has its own API     │  │ "Brain holds all API keys.      │
  │  key. I can't track total       │  │  Per-agent spend tracking,      │
  │  spend or enforce limits."      │  │  budget enforcement, model      │
  └─────────────────────────────────┘  │  routing — centralized."        │
                                       └─────────────────────────────────┘

                   HABIT                                   ANXIETY
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │ "I set per-agent API keys and   │  │ "Centralizing keys means        │
  │  check provider dashboards."    │  │  single point of failure."      │
  └─────────────────────────────────┘  └─────────────────────────────────┘
```

**Switch likelihood**: MEDIUM-HIGH — Push grows with agent count. Anxiety (SPOF) is real but mitigated by Brain being the single orchestration point anyway.

---

## Summary: Opportunity Ranking

| Job | Push | Pull | Habit Strength | Anxiety | Switch Likelihood |
|-----|------|------|----------------|---------|-------------------|
| J1: Context-Aware Coding | Strong | Strong | Weak | Low | **HIGH** |
| J3: Governed Execution | Strong | Strong | Medium | Medium | **HIGH** |
| J6: Multi-Agent Coord | Strong | Strong | Medium | Low | **HIGH** |
| J4: Native Traces | Strong | Strong | Medium | Low | **HIGH** |
| J2: Zero-Config Onboard | Strong | Strong | Medium | Medium | **MED-HIGH** |
| J7: Model/Spend Control | Medium | Strong | Medium | Medium | **MED-HIGH** |
| J5: Real-Time Streaming | Medium | Strong | Medium | Medium | **MEDIUM** |

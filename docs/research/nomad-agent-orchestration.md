# Research: HashiCorp Nomad for Local Agent Isolation

**Date**: 2026-03-29 | **Researcher**: nw-researcher (Nova) | **Confidence**: High | **Sources**: 16

## Executive Summary

HashiCorp Nomad in **dev mode** (`nomad agent -dev`) runs as a single-machine process supervisor that replaces manual `useradd` + `iptables` + `systemd-run` scripting with declarative HCL job specs. The value for local Sandbox Agent deployment is **ease of deployment**, not scale.

Instead of manually creating OS users, configuring sudoers, setting up cgroups, and scripting credential injection, Nomad gives you:

- **One job spec** that declares filesystem access, resource limits, and credentials
- **`exec2` driver** with Landlock LSM — filesystem isolation without manual chroot or user management
- **Dynamic workload users** — Nomad assigns an unused UID per task automatically (no `useradd`)
- **Vault template stanzas** — credentials injected into in-memory tmpfs (no manual `.env` copying)
- **`nomad job dispatch`** — spawn isolated agent sessions via API or CLI, each with its own allocation
- **Built-in cleanup** — allocations are garbage collected when sessions complete

**The tradeoff**: Nomad is another binary to install and run, but it replaces 5-6 manual setup steps with a single `nomad job run agent.hcl`. For someone already running Sandbox Agent locally, the question is whether the declarative isolation is worth the Nomad dependency.

### Quick comparison: manual vs Nomad

| Concern | Manual (OS user) | Nomad dev mode |
|---------|-----------------|----------------|
| User creation | `useradd` + `sudoers` | Automatic (dynamic UID) |
| Filesystem restriction | Unix permissions | Landlock `unveil` paths in HCL |
| Resource limits | `systemd-run` flags | `resources {}` block in HCL |
| Claude Code auth | `cp -R ~/.claude/` | Landlock `unveil` read-only to `~/.claude` |
| Session dispatch | `sudo -u sandbox ...` | `nomad job dispatch` |
| Cleanup | Manual `kill` + `rm` | Automatic GC |
| Network restriction | `iptables` rules | Bridge mode + CNI |
| Reproducibility | Shell scripts | Declarative HCL, version-controlled |

The rest of this document covers the detailed mechanics for both single-machine and multi-node setups.

## Research Methodology
**Search Strategy**: Official HashiCorp documentation (developer.hashicorp.com, nomadproject.io), GitHub examples (github.com/hashicorp), industry sources (thoughtworks.com, infoq.com)
**Source Selection**: Types: official/technical_docs/industry | Reputation: high/medium-high min | Verification: cross-referencing across HashiCorp docs and community sources
**Quality Standards**: Target 3 sources/claim (min 1 authoritative) | All major claims cross-referenced | Avg reputation: 1.0

## Single-Machine Quick Start (Dev Mode)

Nomad dev mode runs a full server + client on one machine with no configuration files:

```bash
# Install Nomad (Linux)
curl -fsSL https://releases.hashicorp.com/nomad/1.9.0/nomad_1.9.0_linux_amd64.zip -o nomad.zip
unzip nomad.zip && sudo mv nomad /usr/local/bin/

# Start in dev mode (single machine, no cluster)
sudo nomad agent -dev
```

Root is needed because the `exec2` driver uses Landlock and cgroups.

### Minimal agent job spec

```hcl
# agent.hcl
job "sandbox-agent" {
  type = "batch"

  parameterized {
    meta_required = ["repo_url"]
    meta_optional = ["branch"]
  }

  group "session" {
    task "agent" {
      driver = "exec2"

      config {
        command = "/usr/local/bin/sandbox-agent"
        args    = ["server", "--host", "127.0.0.1", "--port", "${NOMAD_PORT_http}"]

        # Landlock: only these paths are visible to the process
        unveil = [
          "rwc:${NOMAD_TASK_DIR}",          # workspace (read/write/create)
          "rx:/usr/local/bin/claude",        # claude binary
          "rx:/usr/local/bin/sandbox-agent", # sandbox-agent binary
          "rx:/usr/local/bin/git",           # git
          "r:/etc/ssl/certs",               # TLS certs for HTTPS
          "r:/home/marcus/.claude",          # Claude Code auth (read-only)
        ]
      }

      resources {
        cpu    = 2000  # 2 GHz
        memory = 4096  # 4 GB
      }

      network {
        port "http" {}
      }
    }

    # Clone repo before agent starts
    task "setup" {
      lifecycle {
        hook    = "prestart"
        sidecar = false
      }
      driver = "exec2"
      config {
        command = "git"
        args    = ["clone", "${NOMAD_META_repo_url}", "${NOMAD_TASK_DIR}/../agent/local/workspace"]
        unveil  = ["rwc:${NOMAD_TASK_DIR}", "rx:/usr/local/bin/git", "r:/etc/ssl/certs"]
      }
    }
  }
}
```

### Usage

```bash
# Register the job template
nomad job run agent.hcl

# Spawn an isolated agent session
nomad job dispatch -meta repo_url="git@github.com:acme/project.git" sandbox-agent

# Check status
nomad job status sandbox-agent

# View logs
nomad alloc logs <alloc-id>

# Stop a session
nomad job stop sandbox-agent/<dispatch-id>
```

Each dispatch gets its own allocation with a dynamic UID, isolated filesystem (Landlock), and resource limits — no manual user creation needed.

---

## Detailed Findings

### 1. Nomad Job Specification for Agent Workloads

**Evidence**: A Nomad job for spawning a coding agent session uses the `job -> group -> task` hierarchy. The `task` block is "an individual unit of work, such as a Docker container, web application, or batch processing." The `driver` field selects the execution engine, with options including `docker`, `exec`, `exec2`, `raw_exec`, `java`, and `qemu`.
**Source**: [Nomad Task Block](https://developer.hashicorp.com/nomad/docs/job-specification/task) - Accessed 2026-03-29
**Confidence**: High
**Verification**: [Nomad Job Specification Overview](https://developer.hashicorp.com/nomad/docs/job-specification), [Configure Nomad Task Drivers](https://developer.hashicorp.com/nomad/docs/deploy/task-driver)

#### Reference Job Specification

A coding agent session (e.g., an agent analyzing a customer's compliance audit report and generating remediation tasks) would use a batch job with parameterized dispatch:

```hcl
job "coding-agent" {
  type = "batch"

  parameterized {
    payload       = "optional"
    meta_required = ["session_id", "workspace_id", "repo_url"]
    meta_optional = ["branch", "timeout_minutes"]
  }

  group "agent-session" {
    count = 1

    network {
      mode = "bridge"
    }

    task "claude-code" {
      driver = "exec2"

      config {
        command = "/usr/local/bin/sandbox-agent"
        args    = [
          "server",
          "--host", "127.0.0.1",
          "--port", "${NOMAD_PORT_agent}",
          "--token", "${NOMAD_META_session_id}",
        ]
        unveil = [
          "rwc:${NOMAD_TASK_DIR}/workspace",
          "rx:/usr/local/bin/claude",
          "rx:/usr/local/bin/sandbox-agent",
          "r:/etc/ssl/certs",
          "r:/home/marcus/.claude",           # Claude Code auth (read-only)
        ]
      }

      resources {
        cpu        = 2000   # 2 GHz
        memory     = 4096   # 4 GB
        memory_max = 8192   # burst to 8 GB if available
      }

      kill_timeout = "30s"

      dispatch_payload {
        file = "task-context.json"
      }
    }
  }
}
```

#### Driver Selection Guide

| Driver | Isolation | Root Required | Use Case for Agents |
|--------|-----------|---------------|---------------------|
| `exec` | chroot + cgroups v1 | Yes (Linux) | Legacy Linux setups; proven but older isolation model |
| `exec2` | Landlock LSM + cgroups v2 | Yes (Linux 5.15+) | **Recommended**: modern kernel-level filesystem isolation without chroot overhead |
| `raw_exec` | None | No | Development only; runs with Nomad user's full permissions |
| `docker` | Container namespaces | No (daemon required) | When container image reproducibility is needed; heavier startup |

**Analysis**: The `exec2` driver is the strongest fit for coding agent workloads. It provides Landlock-based filesystem isolation (similar to OpenBSD's `unveil`) without chroot overhead, plus cgroups v2 for resource limits. The `unveil` path system allows precise control: grant read-write-create to the workspace directory, read-execute to agent binaries, and nothing else. The `docker` driver is viable when teams already have container images but adds startup latency and image management overhead.

### 2. Isolation Mechanisms

**Evidence**: Nomad provides layered isolation through multiple kernel mechanisms. The exec driver "uses the underlying isolation primitives of the operating system to limit the task's access to resources." The exec2 driver "leverages kernel features such as the Landlock LSM, cgroups v2, and the unshare system utility."
**Source**: [Exec Driver](https://developer.hashicorp.com/nomad/docs/drivers/exec) - Accessed 2026-03-29
**Confidence**: High
**Verification**: [Exec2 Driver](https://developer.hashicorp.com/nomad/plugins/drivers/exec2), [Allocation Filesystems](https://developer.hashicorp.com/nomad/docs/concepts/filesystem)

#### 2a. Filesystem Isolation

**Exec driver (chroot)**: Nomad populates the chroot by linking/copying from host directories (`/bin`, `/etc`, `/lib`, `/lib64`, `/run/resolvconf`, `/sbin`, `/usr`). The `chroot_env` client config customizes this set. Tasks cannot access the host filesystem outside the chroot boundary.

**Exec2 driver (Landlock)**: Uses `go-landlock` for filesystem isolation, "making the host filesystem unreachable except where explicitly allowed." Default access is limited to `$NOMAD_TASK_DIR` and `$NOMAD_ALLOC_DIR`. Additional paths use permission prefixes:
- `r:/path` -- read-only access
- `w:/path` -- write access
- `x:/path` -- executable access
- `c:/path` -- create files
- Combinations: `rwc:/tmp` (read, write, create)

**Docker driver**: "Docker provides resource isolation by way of cgroups and namespaces, and containers essentially have a virtual file system all to themselves." Nomad bind-mounts three directories into the container: `NOMAD_ALLOC_DIR` at `/alloc`, `NOMAD_TASK_DIR` at `/local`, `NOMAD_SECRETS_DIR` at `/secrets`.

#### 2b. Allocation Directory Structure

Every allocation receives an isolated directory tree:

```
alloc/<alloc-id>/
  alloc/
    data/     # Shared ephemeral storage (all tasks in group)
    logs/     # stdout/stderr for every task
    tmp/      # Shared temporary space
  <taskname>/
    local/    # NOMAD_TASK_DIR -- private to task
    secrets/  # NOMAD_SECRETS_DIR -- in-memory tmpfs, noexec
    private/  # Nomad-managed (Vault tokens) -- not visible via CLI
    tmp/      # Task-specific temp
```

For a coding agent, the workspace repository would be cloned into `$NOMAD_TASK_DIR/workspace`, giving the agent read-write access to its working tree while Landlock prevents access to anything outside the allocation.

#### 2c. Process and Resource Isolation

**PID namespace**: Default `"private"` mode isolates processes. Host mode (`"host"`) is available but "allows same-user processes to access sensitive environment variables."

**IPC namespace**: Default `"private"` prevents inter-process communication between tasks.

**User isolation**: The exec2 driver supports "dynamic workload users which enable tasks to be run as a UID/GID that is not assigned to any user." This prevents even root-owned files within the task directory from being accessed by other tasks on the same host.

**Denied UIDs/GIDs**: Administrators can block specific UIDs/GIDs entirely:
```hcl
config {
  denied_host_uids = "0"      # Prevent running as root
  denied_host_gids = "0,10"   # Block root and wheel groups
}
```

**Linux capabilities**: The exec driver defaults to 13 capabilities (including `setuid`, `setgid`, `net_bind_service`). Tasks can use `cap_add`/`cap_drop` to adjust. For coding agents, reducing to minimal capabilities is recommended.

#### 2d. Resource Limits

**CPU**: Specified in MHz (default: 100). Tasks use CPU shares and can burst above limits when no contention exists. Alternatively, `cores` reserves specific CPU cores exclusively.

**Memory**: `memory` sets the soft reservation (default: 300 MB). `memory_max` sets the hard limit for burst scenarios. Supported by exec, exec2, docker, raw_exec, podman, and java drivers.

**Disk**: Controlled via the `ephemeral_disk` group stanza (not per-task). The `secrets` resource parameter sizes the in-memory tmpfs for secrets.

### 3. Dynamic Job Dispatching (Parameterized Jobs)

**Evidence**: "A parameterized job encapsulates work that can be executed with various inputs, functioning like a cluster-wide function." Parameterized jobs "act less like regular Nomad jobs and more like functions." The dispatch mechanism "captures a job's configuration and runtime requirements in a generic way and dispatch is used to provide the input for the job to run against."
**Source**: [Parameterized Block](https://developer.hashicorp.com/nomad/docs/job-specification/parameterized) - Accessed 2026-03-29
**Confidence**: High
**Verification**: [Parameterized Jobs Tutorial](https://developer.hashicorp.com/nomad/tutorials/job-specifications/job-spec-parameterized), [Job Dispatch Command](https://developer.hashicorp.com/nomad/commands/job/dispatch)

#### How It Maps to Agent Sessions

Each user request to spawn a coding agent session becomes a `nomad job dispatch` call:

```bash
# Dispatch a new agent session for a compliance audit analysis
nomad job dispatch \
  -meta session_id="sess-a1b2c3d4" \
  -meta workspace_id="ws-deadbeef" \
  -meta repo_url="git@github.com:acme/compliance-reports.git" \
  -meta branch="main" \
  -meta timeout_minutes="60" \
  coding-agent
```

**Key behaviors**:
1. Nomad registers but does not run the parameterized job on `nomad job run`. It only executes when dispatched.
2. Each dispatch generates a unique job ID (e.g., `coding-agent/dispatch-1710000000-e9dfcaf8`) for individual tracking.
3. Metadata is exposed as `NOMAD_META_<key>` environment variables inside the task.
4. Payload (up to 16 KiB) is written to the task filesystem via `dispatch_payload { file = "..." }`.
5. Dispatched instances cannot be updated -- update the parent job instead.
6. The job type must be `batch` or `sysbatch`.

#### API-Driven Dispatch

For programmatic dispatch from an application server (e.g., Brain's orchestrator):

```typescript
// POST /v1/job/coding-agent/dispatch
const response = await fetch(`${NOMAD_ADDR}/v1/job/coding-agent/dispatch`, {
  method: "POST",
  headers: {
    "X-Nomad-Token": nomadToken,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    Meta: {
      session_id: sessionId,
      workspace_id: workspaceId,
      repo_url: repoUrl,
    },
    Payload: btoa(JSON.stringify(taskContext)),
  }),
});
const { DispatchedJobID, EvalID } = await response.json();
```

#### Auto-Scaling with Batch Workloads

Nomad's autoscaler can "automatically provision clients only when a batch job is enqueued, and decommission them once the work is complete." For bursty agent workloads (e.g., many concurrent agents processing a quarterly compliance review), this prevents paying for idle infrastructure.

### 4. Credential Management

#### Primary approach: Claude Code's existing auth

The Sandbox Agent local provider reuses the host's existing Claude Code installation and credentials. No API keys need to be injected — the agent process just needs read access to the Claude Code auth directory.

With the `exec2` driver, this is a single Landlock `unveil` line:

```hcl
unveil = [
  "r:/home/marcus/.claude",  # Claude Code auth (read-only)
]
```

The agent process can read credentials to authenticate but cannot modify or delete them.

For the manual OS user approach (see `sandbox-agent-user-isolation.md`), this requires copying `~/.claude/` to the sandbox user's home and keeping it in sync when credentials rotate. Nomad's Landlock approach is cleaner — one read-only path, no copying, no sync.

#### Optional: Vault integration for additional secrets

**Evidence**: "Nomad servers and clients coordinate with Vault to derive a Vault token that has access to only the Vault policies the tasks needs." Starting in Nomad 1.7, "Nomad workload identities" allow clients to "use a task's workload identity to authenticate to Vault and obtain a token specific to the task."
**Source**: [Vault Integration](https://developer.hashicorp.com/nomad/docs/secure/vault) - Accessed 2026-03-29
**Confidence**: High
**Verification**: [Vault Block Specification](https://developer.hashicorp.com/nomad/docs/job-specification/vault), [Nomad Secrets Consumption Patterns](https://www.hashicorp.com/en/blog/nomad-secrets-consumption-patterns-vault-integration)

If agent tasks need secrets beyond Claude Code auth (e.g., GitHub tokens for private repos, database credentials for integration tests), Vault templates can inject them into in-memory tmpfs without touching disk. This is not needed for basic Sandbox Agent usage.

### 5. Network Isolation and Egress Control

**Evidence**: "Allocations that use the bridge network mode run in an isolated network namespace and are connected to the bridge." Nomad "invokes the consul-cni CNI plugin to configure iptables rules in the network namespace to force outbound traffic from an allocation to flow through the proxy."
**Source**: [Nomad Network Block](https://developer.hashicorp.com/nomad/docs/job-specification/network) - Accessed 2026-03-29
**Confidence**: Medium
**Verification**: [Consul Service Mesh Integration](https://developer.hashicorp.com/nomad/docs/networking/consul/service-mesh), [CNI Plugins](https://developer.hashicorp.com/nomad/docs/networking/cni)

#### Network Modes

| Mode | Isolation | Use Case |
|------|-----------|----------|
| `host` | None -- shares host network | Development, trusted workloads |
| `bridge` | Isolated namespace, bridged to host | **Recommended for agents**: provides namespace isolation with controlled port exposure |
| `none` | Complete isolation, no interfaces | Tasks that need no network at all |
| `cni/<name>` | Custom CNI plugin | Advanced network policies via third-party plugins |

#### Restricting Egress to Specific Endpoints

For coding agents that should only reach `api.anthropic.com` and `github.com`, there are three approaches:

**Approach 1: Consul Connect Service Mesh (most integrated)**

Use Consul's service mesh with intentions and terminating gateways:

```hcl
group "agent-session" {
  network {
    mode = "bridge"
  }

  service {
    name = "coding-agent"
    connect {
      sidecar_service {
        proxy {
          upstreams {
            destination_name = "anthropic-api"
            local_bind_port  = 8443
          }
          upstreams {
            destination_name = "github-api"
            local_bind_port  = 8444
          }
        }
      }
    }
  }
}
```

Consul's Envoy sidecar proxy enforces that only declared upstreams are reachable. Egress gateways (configured via the `terminating` parameter) route traffic to external services through controlled exit points.

**Approach 2: CNI Plugin with iptables (most direct)**

Use a custom CNI configuration to apply iptables rules at the network namespace level:

```json
{
  "cniVersion": "0.4.0",
  "name": "agent-restricted",
  "plugins": [
    { "type": "bridge", "bridge": "nomad-agent", "isGateway": true },
    { "type": "firewall" },
    { "type": "portmap", "capabilities": {"portMappings": true} }
  ]
}
```

Combined with iptables rules that allowlist specific destination IPs.

**Approach 3: DNS-based restriction**

Configure the network block's DNS to point at a resolving-only DNS server that returns results only for allowed domains:

```hcl
network {
  mode = "bridge"
  dns {
    servers  = ["10.0.0.53"]       # Internal DNS with allowlist
    searches = []
    options  = ["timeout:2"]
  }
}
```

**Analysis**: Approach 1 (Consul Connect) provides the most integrated solution but requires running Consul alongside Nomad. Approach 2 is effective without Consul but requires custom CNI configuration. Approach 3 (DNS) is the simplest but can be bypassed by direct IP access. For production agent workloads processing sensitive data (e.g., customer financial records), Consul Connect is recommended because it provides mTLS between services and auditable traffic policies.

### 6. Multi-Tenancy for Concurrent Agent Sessions

**Evidence**: "Namespaces allow a cluster to be shared by multiple teams within a company, and using this logical separation is important for multi-tenant clusters to prevent users without access to that namespace from conflicting with each other." Resource quotas "provide a means for operators to limit CPU and memory consumption across namespaces to guarantee that no single tenant can dominate usage."
**Source**: [Create and Use Namespaces](https://developer.hashicorp.com/nomad/tutorials/manage-clusters/namespaces) - Accessed 2026-03-29
**Confidence**: High
**Verification**: [ACL System](https://developer.hashicorp.com/nomad/docs/secure/acl), [Multi-Tenant Nomad Considerations](https://www.hashicorp.com/en/resources/multi-tenant-nomad-considerations-your-cluster)

#### Multi-Tenancy Architecture for Agent Sessions

Each workspace (or tenant) in Brain can map to a Nomad namespace:

```bash
# Create namespace per workspace
nomad namespace apply -description "Acme Corp workspace" acme-corp

# Dispatch agent sessions into the workspace namespace
nomad job dispatch -namespace acme-corp coding-agent \
  -meta session_id="sess-xyz" \
  -meta workspace_id="ws-acme"
```

#### Isolation Layers

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Logical | Namespaces | Separate job visibility, prevent cross-tenant job access |
| Access | ACL policies | Control which tokens can submit/read/cancel jobs per namespace |
| Resource | Quotas | Cap CPU/memory per namespace; "when a resource quota is exhausted, Nomad will queue incoming work" |
| Process | cgroups/Landlock per task | OS-level isolation between concurrent tasks on the same node |
| Network | Bridge mode per group | Isolated network namespace per allocation |

#### ACL Policy Example

```hcl
namespace "acme-corp" {
  policy = "write"
  capabilities = ["submit-job", "dispatch-job", "read-logs", "alloc-exec"]
}

namespace "default" {
  policy = "deny"
}
```

#### Concurrent Session Limits

Resource quotas prevent a single workspace from consuming all cluster resources:

```hcl
quota "acme-corp-limit" {
  limit {
    region = "global"
    region_limit {
      cpu        = 16000   # 16 GHz total across all jobs
      memory     = 32768   # 32 GB total
    }
  }
}
```

If an agent session dispatch would exceed the quota, Nomad queues it until resources free up rather than failing immediately.

### 7. Lifecycle Management (Timeouts, Cleanup, Reclamation)

**Evidence**: The `kill_timeout` is the "duration to wait for an application to gracefully quit before force-killing" (default: 5s). The `restart` block configures local restart behavior: for batch jobs, default is 3 attempts in 24 hours. The `reschedule` block handles cross-node rescheduling after local restarts are exhausted: batch jobs default to 1 attempt in 24 hours.
**Source**: [Restart Block](https://developer.hashicorp.com/nomad/docs/job-specification/restart) - Accessed 2026-03-29
**Confidence**: High
**Verification**: [Reschedule Block](https://developer.hashicorp.com/nomad/docs/job-specification/reschedule), [Task Block](https://developer.hashicorp.com/nomad/docs/job-specification/task)

#### Agent Session Lifecycle Configuration

```hcl
group "agent-session" {
  # Disable rescheduling -- a failed agent session should not auto-retry
  # on a different node (the workspace state may be inconsistent)
  reschedule {
    attempts  = 0
    unlimited = false
  }

  # Limit local restarts -- if the agent crashes, retry once
  restart {
    attempts = 1
    delay    = "10s"
    interval = "5m"
    mode     = "fail"
  }

  task "claude-code" {
    # Graceful shutdown: give agent 30s to save state before kill
    kill_timeout = "30s"

    # Mark as group leader -- when this task exits, the entire group stops
    leader = true
  }
}
```

#### Session Timeout Enforcement

Nomad does not have a built-in "max runtime" for batch jobs. Two approaches for enforcing session timeouts:

**Approach 1: Wrapper script**
```bash
#!/bin/bash
timeout ${NOMAD_META_timeout_minutes:-60}m sandbox-agent server ...
```

**Approach 2: External monitoring**
The orchestrator (Brain) monitors the dispatched job via the Nomad API and stops it after the timeout:

```typescript
// Poll job status
const status = await fetch(`${NOMAD_ADDR}/v1/job/${dispatchedJobId}`);
if (elapsedMinutes > maxTimeout) {
  await fetch(`${NOMAD_ADDR}/v1/job/${dispatchedJobId}`, {
    method: "DELETE",
    headers: { "X-Nomad-Token": nomadToken },
  });
}
```

#### Cleanup and Garbage Collection

- Dispatched batch jobs are "naturally garbage collected by Nomad over time" after completion.
- The `nomad job stop -purge <job-id>` command forces immediate cleanup.
- Allocation directories (including workspace files) are removed when the allocation is garbage collected.
- For long-running sessions with valuable artifacts, use the `artifact` stanza or external storage (S3, NFS) to persist results before the allocation is cleaned up.

#### Lifecycle Hooks for Pre/Post Processing

```hcl
# Clone the repository before the agent starts
task "git-clone" {
  lifecycle {
    hook    = "prestart"
    sidecar = false
  }
  driver = "exec2"
  config {
    command = "git"
    args    = ["clone", "${NOMAD_META_repo_url}", "${NOMAD_TASK_DIR}/workspace"]
  }
}

# Push results after the agent completes
task "push-results" {
  lifecycle {
    hook    = "poststop"
    sidecar = false
  }
  driver = "exec2"
  config {
    command = "/usr/local/bin/push-agent-results"
    args    = ["--session", "${NOMAD_META_session_id}"]
  }
}
```

### 8. Comparison: Nomad vs OS Users vs Docker

**Evidence**: Nomad "supports a wider range of workloads, including virtual machines, Java apps, and batch processing jobs." Its "single binary deployment model" reduces operational complexity compared to Kubernetes. The exec2 driver provides "very low startup times and minimal overhead in terms of CPU, disk, and memory utilization."
**Source**: [What is Nomad](https://developer.hashicorp.com/nomad/docs/what-is-nomad) - Accessed 2026-03-29
**Confidence**: High
**Verification**: [Nomad Product Page](https://www.hashicorp.com/en/products/nomad), [Batch Processing Use Cases](https://www.nomadproject.io/use-cases/batch-processing-workloads)

#### Comparison Matrix

| Dimension | OS User Isolation | Docker Containers | Nomad Orchestration |
|-----------|------------------|-------------------|---------------------|
| **Setup complexity** | Low -- `useradd` + `sudoers` | Medium -- Dockerfile + daemon | High -- Nomad cluster + (optional) Consul + Vault |
| **Filesystem isolation** | Unix permissions (uid/gid) | Container filesystem + bind mounts | Landlock/chroot + allocation dirs |
| **Network isolation** | None (shared host network) | Docker networks + iptables | Bridge mode + Consul Connect or CNI |
| **Resource limits** | `ulimit` (crude) | cgroups via Docker | cgroups via Nomad (same mechanism, better orchestration) |
| **Multi-tenancy** | Separate OS users per tenant | Separate containers/networks | Namespaces + ACLs + quotas |
| **Secrets management** | Environment variables or files | Docker secrets or env vars | Vault integration with auto-renewal |
| **Scaling** | Manual -- one machine | Manual or Docker Swarm | Built-in scheduler + autoscaler |
| **Session dispatch** | `sudo -u <user>` shell exec | `docker run` per session | `nomad job dispatch` via API |
| **Cleanup** | Manual process cleanup | `docker rm` + volume prune | Automatic garbage collection |
| **Monitoring** | DIY (ps, logs) | Docker logs + stats | Built-in allocation logs, metrics, Prometheus integration |
| **Startup latency** | Near-zero | 1-5 seconds (image pull cached) | Near-zero (exec2), 1-5s (docker) |
| **Infrastructure cost** | Single machine | Single machine + Docker daemon | 3+ nodes (server quorum) minimum |
| **When appropriate** | 1-5 concurrent agents, single machine | 5-50 concurrent agents, single or few machines | 10-1000+ concurrent agents, multi-node fleet |

#### When to Choose Each Approach

**OS user isolation** -- Choose when:
- Running on a single machine with low concurrency (1-5 agents)
- Operational simplicity is paramount
- The team has no container or orchestration expertise
- Budget constraints prevent multi-node infrastructure

**Docker containers** -- Choose when:
- Reproducible environments are needed (consistent tooling across agents)
- Moderate concurrency (5-50 agents) on a small cluster
- The team already uses Docker in their workflow
- Network isolation between agents is required but Consul/Nomad overhead is not justified

**Nomad orchestration** -- Choose when:
- High concurrency (10-1000+ agents) across a multi-node fleet
- Multi-tenancy with strong isolation between workspaces is required
- Dynamic scaling (agents spin up/down based on demand) is needed
- Centralized secret management (Vault) is already in use or planned
- Audit trails for agent sessions are a compliance requirement
- The system needs to survive node failures (Nomad reschedules allocations)

#### When Nomad Is Worth It on a Single Machine

Nomad dev mode on a single machine is worth the dependency when:

1. **You want declarative isolation** — one HCL file replaces shell scripts for user creation, cgroups, iptables, and credential copying. Version-control the job spec, not a README of manual steps.
2. **You dispatch multiple sessions** — `nomad job dispatch` is cleaner than juggling `sudo -u` processes and tracking PIDs manually.
3. **You want automatic cleanup** — Nomad GCs completed allocations. No orphaned processes or leftover directories.
4. **You plan to scale later** — the same job spec works on a multi-node cluster. No rewrite needed.

When it's **not** worth it:

1. **One-off usage** — if you're running a single agent session occasionally, `sudo -u sandbox-user claude` is simpler.
2. **macOS** — Nomad's `exec` and `exec2` drivers require Linux. On macOS you're limited to `raw_exec` (no isolation) or Docker driver.
3. **No root access** — `exec2` needs root for Landlock and cgroups. Without root, fall back to OS user isolation.

See also: [`sandbox-agent-user-isolation.md`](sandbox-agent-user-isolation.md) for the manual OS user approach.

## Source Analysis

| Source | Domain | Reputation | Type | Access Date | Cross-verified |
|--------|--------|------------|------|-------------|----------------|
| Nomad Task Block | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Nomad Job Specification | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Exec Driver (Isolated Fork/Exec) | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Exec2 Driver Plugin | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Allocation Filesystems | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Parameterized Block | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Parameterized Jobs Tutorial | developer.hashicorp.com | High | Official tutorial | 2026-03-29 | Y |
| Job Dispatch Command | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Vault Block Specification | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Vault Integration Overview | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Nomad Secrets Patterns Blog | hashicorp.com | High | Official blog | 2026-03-29 | Y |
| Network Block Specification | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Consul Service Mesh Integration | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Restart Block Specification | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| Reschedule Block Specification | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |
| ACL System Overview | developer.hashicorp.com | High | Official docs | 2026-03-29 | Y |

Reputation: High: 16 (100%) | Medium-high: 0 (0%) | Avg: 1.0

## Knowledge Gaps

### Gap 1: Nomad Built-in Max Runtime for Batch Jobs
**Issue**: Nomad does not appear to have a native `max_runtime` stanza for batch jobs. Session timeout enforcement requires either a wrapper script or external monitoring. Searched the job specification docs, restart/reschedule blocks, and batch scheduler docs.
**Attempted**: developer.hashicorp.com job specification, lifecycle block, restart block, reschedule block
**Recommendation**: Confirm with HashiCorp whether a `max_runtime` or equivalent has been added in Nomad 1.9+. If not, implement timeout via the orchestrator polling approach documented in Finding 7.

### Gap 2: Consul Connect Egress Allowlisting by Domain Name
**Issue**: While Consul Connect provides mTLS and service intentions, allowlisting egress by domain name (e.g., `api.anthropic.com`) rather than by IP requires terminating gateways plus external DNS resolution. The exact configuration for domain-based egress filtering was not found in the consulted sources.
**Attempted**: Consul service mesh docs, Nomad networking docs, CNI plugin docs
**Recommendation**: Research Consul terminating gateways and Envoy's external authorization filter for domain-based egress control. Alternatively, use CNI iptables rules with DNS-resolved IP allowlists updated on a schedule.

### Gap 3: Exec2 Driver Maturity and Production Adoption
**Issue**: The exec2 driver was introduced in Nomad 1.8 (2024) and relies on Landlock LSM (Linux 5.15+). Real-world production experience reports for the exec2 driver were not found -- only official documentation and release announcements.
**Attempted**: HashiCorp blog, HashiCorp Discuss forums, general web search
**Recommendation**: Monitor HashiCorp Discuss and GitHub issues for production experience reports. Consider starting with the exec (chroot) driver in production and migrating to exec2 after confirming Landlock behavior on the target kernel version.

### Gap 4: Nomad Autoscaler for Batch Workloads at Scale
**Issue**: The autoscaler is documented for horizontal cluster scaling with batch jobs, but specific configuration examples for on-demand node provisioning per-dispatch (cloud provider integration, scaling policies for bursty agent workloads) were not extracted in this research.
**Attempted**: Nomad autoscaler tutorial, batch processing use cases page
**Recommendation**: Deep-dive into the Nomad Autoscaler plugin documentation for cloud provider (AWS ASG, GCP MIG) integration and scaling policy configuration.

## Conflicting Information

No significant conflicts were found across sources. All sources are from HashiCorp's official documentation, which is internally consistent. Minor note: the `exec` driver documentation uses "Isolated Fork/Exec" as its full name in some pages and simply "exec" in others -- this is a naming convention difference, not a technical conflict.

## Full Citations

[1] HashiCorp. "task block in the job specification." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/job-specification/task. Accessed 2026-03-29.
[2] HashiCorp. "Nomad job specification." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/job-specification. Accessed 2026-03-29.
[3] HashiCorp. "Configure the Isolated Fork/Exec task driver." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/drivers/exec. Accessed 2026-03-29.
[4] HashiCorp. "Exec2 task driver plugin." Nomad Documentation. https://developer.hashicorp.com/nomad/plugins/drivers/exec2. Accessed 2026-03-29.
[5] HashiCorp. "Allocation Filesystems." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/concepts/filesystem. Accessed 2026-03-29.
[6] HashiCorp. "parameterized block in the job specification." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/job-specification/parameterized. Accessed 2026-03-29.
[7] HashiCorp. "Create a parameterized Nomad job." Nomad Tutorials. https://developer.hashicorp.com/nomad/tutorials/job-specifications/job-spec-parameterized. Accessed 2026-03-29.
[8] HashiCorp. "nomad job dispatch command reference." Nomad Documentation. https://developer.hashicorp.com/nomad/commands/job/dispatch. Accessed 2026-03-29.
[9] HashiCorp. "vault block in the job specification." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/job-specification/vault. Accessed 2026-03-29.
[10] HashiCorp. "Vault Integration." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/secure/vault. Accessed 2026-03-29.
[11] HashiCorp. "Nomad secrets consumption patterns: Vault integration." HashiCorp Blog. https://www.hashicorp.com/en/blog/nomad-secrets-consumption-patterns-vault-integration. Accessed 2026-03-29.
[12] HashiCorp. "network block in the job specification." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/job-specification/network. Accessed 2026-03-29.
[13] HashiCorp. "Integrate Consul service mesh." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/networking/consul/service-mesh. Accessed 2026-03-29.
[14] HashiCorp. "restart block in the job specification." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/job-specification/restart. Accessed 2026-03-29.
[15] HashiCorp. "reschedule block in the job specification." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/job-specification/reschedule. Accessed 2026-03-29.
[16] HashiCorp. "ACL system overview." Nomad Documentation. https://developer.hashicorp.com/nomad/docs/secure/acl. Accessed 2026-03-29.

## Research Metadata
Duration: ~40 min | Examined: 22 | Cited: 16 | Cross-refs: 16 | Confidence: High 87.5%, Medium 12.5%, Low 0% | Output: docs/research/nomad-agent-orchestration.md

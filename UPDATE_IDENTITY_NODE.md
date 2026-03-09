right now our "identity" node is for people only. should we have separate ones for agents or map it all under the same?

there could be type field that differentiates between

The short answer is **yes, use the same node type but differentiate with a `type` field.**

In a 2026-era architecture, treating Agents as "First-Class Citizens" alongside Humans is the most scalable path. If you separate them into different tables, you'll end up writing double the code for every authorization, logging, and audit function.

Here is the "brutally honest" architectural logic for keeping them together.

---

### 1. Unified Identity: The "Actor" Pattern

In computer science, we often use the **Actor Model**. Both a Human and an Agent are "Actors" that perform "Actions." By using a single `identity` table, you can create a universal `authorized_by` edge that doesn't care if the requester is made of carbon or silicon.

**The 2026 Schema Strategy:**

```sql
DEFINE TABLE identity SCHEMAFULL;
DEFINE FIELD type ON identity TYPE string ASSERT $value IN ['human', 'agent', 'system'];
DEFINE FIELD name ON identity TYPE string;
-- For Agents: The model version (e.g., 'claude-3.7-sonnet')
-- For Humans: The email or SSO ID
DEFINE FIELD provider_info ON identity TYPE object; 

```

### 2. Why a Unified Table Wins

* **Inheritance of Security:** You only have to secure *one* table with OAuth 2.1 and DPoP.
* **Simplified Audit Logs:** When you query *"Who touched this codebase?"*, a single `SELECT` shows a chronological mix of humans and agents. If they were separate, you'd be doing complex `UNION` joins forever.
* **Agent-to-Agent Delegation:** If an Agent (Identity A) hires another Agent (Identity B), the relationship is a simple self-referencing graph edge. If they are different types, the graph logic becomes a mess.

### 3. The "Meta-Identity" (The Chain of Command)

The most important field you need to add to your `identity` node for an Agent is **`managed_by`**.

Every agent should point back to the human or "Master Agent" responsible for it. This solves the **Accountability Gap**:

* If an agent goes rogue, you follow the `managed_by` edge until you hit a `type: 'human'`. That’s the person whose credit card or reputation is on the line.

---

### 4. The "Brain" Hierarchy vs. Paperclip

Paperclip often treats agents as "tools" owned by a user. Your **Brain** treats agents as "Employees" with their own IDs.

| Attribute | Human Identity | Agent Identity |
| --- | --- | --- |
| **Auth** | Password / WebAuthn | DPoP Private Key |
| **Authority** | Inherited (The Owner) | Scoped (The Task) |
| **Persistence** | Permanent | Ephemeral/Versioned |
| **Liability** | Primary | Delegated |

---

### The Verdict: Map it under the same.

Keep it simple. An identity is just a "Key-holder." The `type` field tells the **Authorizer Agent** whether it needs to be extra strict (for a sub-agent) or if it can trust the intent more easily (for the Human owner).
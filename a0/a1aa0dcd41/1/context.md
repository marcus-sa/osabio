# Session Context

## User Prompts

### Prompt 1

would it make sense to extend https://github.com/marcus-sa/brain/issues/127 with features from https://github.com/dtkav/agent-creds ? particularly preventing secrets leakage. we're already limiting agent blast radius with oauth 2.1 rar + dpop

### Prompt 2

yes

### Prompt 3

would this be related to https://github.com/marcus-sa/brain/issues/136

### Prompt 4

yes, update #136

### Prompt 5

let's draft a linkedin article for this

### Prompt 6

shouldnt we just run a secret scanner on llm requests and block any that contains secrets?

### Prompt 7

[Request interrupted by user]

### Prompt 8

should we also run a secret scanner on llm requests and block any that contains secrets?

### Prompt 9

yes

### Prompt 10

tables dont work in linkedin

### Prompt 11

ok, now i need to add a desc to linked in post that shares the article (needs to incentivize people to read it) along with tags

### Prompt 12

too many tags, max 5

### Prompt 13

explain: why #InfoSec and #APISecurity instead of #CyberSecurity ?

### Prompt 14

someone in my network commented: "Hey Marcus… Not yet having had the reasons to deeply delve into AI agents and sich, and being naturally cautious and skeptical about them, i read the entirety of the article, and the Brain-readme as well. Looks very expansive, and i have a trivial question- If i am using a PC-exevuted agent- Claude, ChatGPT… How does the flow you propose guarantee that the network traffic only flows though your stack, and not circumventing it, or using it as additional connec...

### Prompt 15

i mean it doesnt, but the agent would have no way to send http requests to api with credentials, because they have no credentials available. and for pc executed agents, u would setup e.g a claude code proxy so that all proxies to claude codes api first flows through brain, which is what enabled the trace capture

### Prompt 16

he replied: "oh, right - of course - the “proxy part” got away from my attention in reading all of what you wrote about this… so, ok… there’s a networking proxy-forwarder built into Brain, so any networking goes there from the userrs requests into networks"

### Prompt 17

someone else commented: "This extends beyond API keys. We run agents that process financial documents - borrower SSNs, income figures, account numbers all flowing through the LLM context. Same architectural problem, different data class. The principle you landed on generalizes well: minimize what the agent actually needs to see. In our case agents get derived signals rather than raw PII wherever possible. The smaller the context surface, the smaller the blast radius."

### Prompt 18

haha interesting, i just found this linked in post which is directly relevant: "I hacked Perplexity Computer and got unlimited Claude Code access, billed directly to Perplexity's master Anthropic account.

I used their own AI to hack itself.

I was researching how Perplexity Computer handles sandbox isolation for my own agent infrastructure work.
I noticed Claude Code was installed in the sandbox and started wondering...

How are they handling the API keys?
How is the key scoped?
Is it isolat...

### Prompt 19

well, i want to comment on his post referencing my article

### Prompt 20

too many characters: -292

### Prompt 21

which of my articles do i link to ?


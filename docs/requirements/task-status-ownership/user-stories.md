# User Stories: Task Status Ownership

## US-1: Remove server-side in_progress on assignment

**As** a developer using the orchestrator,
**I want** the server to stop setting in_progress when creating an agent session,
**So that** only the agent that actually starts work owns that transition.

**Traces to**: Job 1 (Accurate Task Progress), Job 3 (Graceful Recovery)
**Size**: S

## US-2: Remove server-side done on session accept

**As** a developer reviewing agent work,
**I want** session accept to only affect session lifecycle (not task status),
**So that** task completion is tied to actual code, not review approval.

**Traces to**: Job 1 (Accurate Task Progress), Job 2 (Reliable Task Tracking)
**Size**: S

## US-3: Add brain commit-check CLI command

**As** a solo developer committing code locally,
**I want** a `brain commit-check` command that parses task refs from commit messages and sets tasks to done,
**So that** task status updates automatically when I commit without needing a remote push.

**Traces to**: Job 1 (Accurate Task Progress)
**Size**: M

## US-4: Wire commit-check as post-commit hook

**As** a developer using Brain-managed repositories,
**I want** `brain commit-check` to run automatically as a git post-commit hook,
**So that** I don't have to remember to run it manually after every commit.

**Traces to**: Job 1 (Accurate Task Progress)
**Size**: S

## US-5: GitHub processor sets done on push

**As** a team lead with agents pushing to remote branches,
**I want** the GitHub commit processor to set referenced tasks to done when commits are pushed,
**So that** the team can see which tasks have finished work pending review.

**Traces to**: Job 2 (Reliable Task Tracking)
**Size**: S

## US-6: GitHub processor sets completed on merge to main

**As** a team lead tracking shipped work,
**I want** tasks to be marked completed when their commits merge to main,
**So that** "completed" means the code is verified and landed — not just that an agent finished.

**Traces to**: Job 2 (Reliable Task Tracking)
**Size**: M

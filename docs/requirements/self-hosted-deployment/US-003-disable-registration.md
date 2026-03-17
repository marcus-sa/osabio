# US-003: Disable Registration in Self-Hosted Mode

## Problem
Marcus has deployed Brain for his team with a pre-seeded admin account. However, the signup endpoint is still open, meaning anyone on the internal network can create accounts without authorization. He needs registration locked down so that only the seeded admin (and future invited users) can access the instance.

## Who
- Platform operator | Running a self-hosted Brain instance on an internal network | Wants to prevent unauthorized account creation

## Solution
When `SELF_HOSTED=true`, the signup endpoint returns HTTP 403 with a clear message. The login endpoint continues to work normally against the seeded admin account. The signup UI element (link/button) is hidden.

## Job Traceability
- Job 2: Closed Registration

## Domain Examples

### 1: Unauthorized signup blocked (Happy Path)
An employee named Dmitri discovers the Brain URL on the internal network and tries to sign up at `/auth/signup`. The endpoint returns 403 with body `{"error": "Registration is disabled"}`. Dmitri cannot create an account.

### 2: Admin login works normally (Happy Path)
Marcus navigates to the login page, enters `marcus@nwave.io` and his password. Authentication succeeds via the standard Better Auth flow. He reaches the dashboard.

### 3: Non-self-hosted registration still works (Boundary)
On a cloud-hosted instance without `SELF_HOSTED`, a new user Sofia registers at `/auth/signup` with `sofia@startup.io`. Registration succeeds normally -- the self-hosted guard is not active.

## UAT Scenarios (BDD)

### Scenario: Signup returns 403 in self-hosted mode
Given the server is running with SELF_HOSTED=true
When Dmitri sends a POST to the signup endpoint with email "dmitri@internal.net"
Then the response status is 403
And the response body contains "Registration is disabled"

### Scenario: Login works for seeded admin
Given the server is running with SELF_HOSTED=true
And the admin user "marcus@nwave.io" was seeded during migration
When Marcus logs in with email "marcus@nwave.io" and the correct password
Then authentication succeeds
And Marcus receives a valid session

### Scenario: Signup UI element hidden in self-hosted mode
Given the server is running with SELF_HOSTED=true
When a visitor navigates to the login page
Then no signup link or registration button is visible

### Scenario: Registration works when not self-hosted
Given the server is running without SELF_HOSTED set
When Sofia registers with email "sofia@startup.io" and a password
Then registration succeeds
And Sofia can log in with her new account

## Acceptance Criteria
- [ ] Signup endpoint returns HTTP 403 when `SELF_HOSTED=true`
- [ ] Response body includes clear "Registration is disabled" message
- [ ] Login endpoint is unaffected -- works normally for seeded admin
- [ ] Signup UI element (link/button) hidden when self-hosted mode active
- [ ] Registration works normally when `SELF_HOSTED` is not true

## Technical Notes
- Guard must be applied at the Better Auth signup route level (before auth hooks, not after)
- The `SELF_HOSTED` flag is already in `ServerConfig` from US-001
- This lays the groundwork for a future invitations feature (not in scope)
- Signup UI hiding requires the self-hosted flag to be available to the client -- either via an API endpoint or server-rendered config

## Dependencies
- US-001 (Self-Hosted Environment Configuration) -- provides `config.selfHosted`
- US-002 (Admin Seed) -- admin must exist before registration is disabled

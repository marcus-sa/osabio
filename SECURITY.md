# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Osabio, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email: **marcus@schack.systems**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive an acknowledgment within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

The following are in scope:
- Osabio server (`app/`)
- Osabio CLI and MCP server (`cli/`)
- OAuth 2.1 / DPoP / RAR authentication (`app/src/server/orchestrator/`, `app/src/server/mcp/`)
- SurrealDB schema and queries (`schema/`)

The following are out of scope:
- Third-party dependencies (report to the upstream project)
- SurrealDB itself (report to [SurrealDB](https://surrealdb.com/security))

## Supported Versions

Osabio is pre-1.0. Security fixes are applied to the `main` branch only.

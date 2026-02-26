# Phase 1 Manual UI Smoke

1. Start dependencies:
   - `docker compose up surrealdb surrealdb-init`
2. Start app:
   - `bun run start`
3. Open `http://127.0.0.1:3000`.
4. Send a message containing explicit task/decision/question language.
5. Verify streaming behavior:
   - assistant response appears incrementally
   - stream completes without reload
6. Verify extraction rendering:
   - entity badges render under the assistant response
   - relationship badges render under the assistant response
7. Type `@` in chat input and verify mention suggestions return extracted entities.
8. Optionally run script check:
   - `bun run smoke:phase1`

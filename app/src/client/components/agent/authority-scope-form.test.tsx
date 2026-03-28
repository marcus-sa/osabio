import { describe, it, expect, mock } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthorityScopeInput } from "../../hooks/use-agent-actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_ACTIONS = [
  "create_task",
  "create_decision",
  "create_observation",
  "create_suggestion",
  "create_question",
  "edit_task",
  "edit_decision",
  "create_intent",
  "submit_intent",
  "create_session",
  "create_commit",
] as const;

const ALL_LABELS = [
  "Create tasks",
  "Create decisions",
  "Create observations",
  "Create suggestions",
  "Create questions",
  "Edit tasks",
  "Edit decisions",
  "Create intents",
  "Submit intents",
  "Create sessions",
  "Create commits",
];

function defaultScopes(): AuthorityScopeInput[] {
  return ALL_ACTIONS.map((action) => ({ action, permission: "propose" as const }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthorityScopeForm", () => {
  it("renders all 11 authority actions as rows", async () => {
    const { AuthorityScopeForm } = await import("./authority-scope-form");
    const onChange = mock(() => {});

    render(
      <AuthorityScopeForm scopes={defaultScopes()} onChange={onChange} />,
    );

    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Verify exactly 11 rows in tbody (one per action)
    const rows = screen.getAllByRole("row");
    // 1 header row + 11 data rows
    expect(rows.length).toBe(12);
  });

  it("shows propose selected by default for all actions", async () => {
    const { AuthorityScopeForm } = await import("./authority-scope-form");
    const onChange = mock(() => {});

    render(
      <AuthorityScopeForm scopes={defaultScopes()} onChange={onChange} />,
    );

    const checkedRadios = screen.getAllByRole("radio", { checked: true });
    expect(checkedRadios.length).toBe(11);

    // Each checked radio should have value "propose"
    for (const radio of checkedRadios) {
      expect((radio as HTMLInputElement).value).toBe("propose");
    }
  });

  it("provides auto, propose, and blocked options for each action", async () => {
    const { AuthorityScopeForm } = await import("./authority-scope-form");
    const onChange = mock(() => {});

    render(
      <AuthorityScopeForm scopes={defaultScopes()} onChange={onChange} />,
    );

    // 11 actions x 3 permissions = 33 radio buttons
    const allRadios = screen.getAllByRole("radio");
    expect(allRadios.length).toBe(33);

    // Column headers present
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("Propose")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("calls onChange with updated scopes when permission is changed", async () => {
    const { AuthorityScopeForm } = await import("./authority-scope-form");
    const onChange = mock(() => {});

    render(
      <AuthorityScopeForm scopes={defaultScopes()} onChange={onChange} />,
    );

    // Find the row for "Create tasks" and click the "auto" radio
    const createTasksRow = screen.getByText("Create tasks").closest("tr")!;
    const radiosInRow = within(createTasksRow).getAllByRole("radio");
    // Order: auto, propose, blocked
    const autoRadio = radiosInRow[0];

    await userEvent.click(autoRadio);

    expect(onChange).toHaveBeenCalledTimes(1);
    const updatedScopes = onChange.mock.calls[0][0] as AuthorityScopeInput[];
    const createTaskScope = updatedScopes.find((s) => s.action === "create_task");
    expect(createTaskScope?.permission).toBe("auto");
  });

  it("disables all radio buttons when disabled prop is true", async () => {
    const { AuthorityScopeForm } = await import("./authority-scope-form");
    const onChange = mock(() => {});

    render(
      <AuthorityScopeForm scopes={defaultScopes()} onChange={onChange} disabled={true} />,
    );

    const allRadios = screen.getAllByRole("radio");
    for (const radio of allRadios) {
      expect((radio as HTMLInputElement).disabled).toBe(true);
    }
  });
});

import type { AuthorityScopeInput, AuthorityPermission } from "../../hooks/use-agent-actions";
import { Label } from "../ui/label";

const AUTHORITY_ACTIONS = [
  { action: "create_decision", label: "Create decisions" },
  { action: "confirm_decision", label: "Confirm decisions" },
  { action: "create_task", label: "Create tasks" },
  { action: "complete_task", label: "Complete tasks" },
  { action: "create_observation", label: "Create observations" },
  { action: "acknowledge_observation", label: "Acknowledge observations" },
  { action: "resolve_observation", label: "Resolve observations" },
  { action: "create_question", label: "Create questions" },
  { action: "create_suggestion", label: "Create suggestions" },
  { action: "create_intent", label: "Create intents" },
  { action: "submit_intent", label: "Submit intents" },
] as const;

const PERMISSIONS: { value: AuthorityPermission; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "propose", label: "Propose" },
  { value: "blocked", label: "Blocked" },
];

type AuthorityScopeFormProps = {
  scopes: AuthorityScopeInput[];
  onChange: (scopes: AuthorityScopeInput[]) => void;
  disabled?: boolean;
};

function getPermission(scopes: AuthorityScopeInput[], action: string): AuthorityPermission {
  return scopes.find((s) => s.action === action)?.permission ?? "propose";
}

export function AuthorityScopeForm({ scopes, onChange, disabled }: AuthorityScopeFormProps) {
  function handleChange(action: string, permission: AuthorityPermission) {
    const existing = scopes.filter((s) => s.action !== action);
    onChange([...existing, { action, permission }]);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium">Authority Scopes</Label>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-3 py-2 font-medium">Action</th>
              {PERMISSIONS.map((p) => (
                <th key={p.value} className="px-3 py-2 text-center font-medium">{p.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AUTHORITY_ACTIONS.map(({ action, label }) => {
              const current = getPermission(scopes, action);
              return (
                <tr key={action} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-foreground">{label}</td>
                  {PERMISSIONS.map((p) => (
                    <td key={p.value} className="px-3 py-2 text-center">
                      <input
                        type="radio"
                        name={`scope-${action}`}
                        value={p.value}
                        checked={current === p.value}
                        onChange={() => handleChange(action, p.value)}
                        disabled={disabled}
                        className="accent-primary"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { AUTHORITY_ACTIONS };

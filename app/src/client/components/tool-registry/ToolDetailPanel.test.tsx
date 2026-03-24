import { describe, it, expect, mock } from "bun:test";

// Mock transitive dependencies to avoid React context / DOM issues
mock.module("../../hooks/use-tool-detail", () => ({
  useToolDetail: () => ({ data: undefined, isLoading: true, error: undefined }),
}));
mock.module("../ui/button", () => ({
  Button: (props: Record<string, unknown>) => props.children,
}));

const { deriveToolDetailViewModel } = await import("./ToolDetailPanel");
type ToolDetailData = import("./ToolDetailPanel").ToolDetailData;

function makeToolDetail(overrides: Partial<ToolDetailData> = {}): ToolDetailData {
  return {
    id: "t1",
    name: "read_file",
    toolkit: "filesystem",
    description: "Read a file",
    risk_level: "low",
    status: "active",
    grant_count: 0,
    governance_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
    grants: [],
    governance_policies: [],
    ...overrides,
  };
}

describe("deriveToolDetailViewModel", () => {
  it("returns loading tag for loading state", () => {
    const vm = deriveToolDetailViewModel({ state: "loading" });
    expect(vm.tag).toBe("loading");
  });

  it("returns error tag with message for error state", () => {
    const vm = deriveToolDetailViewModel({ state: "error", error: "Not found" });
    expect(vm).toEqual({ tag: "error", errorMessage: "Not found" });
  });

  it("formats input schema as pretty JSON", () => {
    const schema = { type: "object", properties: { path: { type: "string" } } };
    const vm = deriveToolDetailViewModel({
      state: "loaded",
      data: makeToolDetail({ input_schema: schema }),
    });

    if (vm.tag !== "loaded") throw new Error("Expected loaded");
    expect(vm.formattedInputSchema).toBe(JSON.stringify(schema, null, 2));
  });

  it("formats output schema when present", () => {
    const outputSchema = { type: "object", properties: { result: { type: "string" } } };
    const vm = deriveToolDetailViewModel({
      state: "loaded",
      data: makeToolDetail({ output_schema: outputSchema }),
    });

    if (vm.tag !== "loaded") throw new Error("Expected loaded");
    expect(vm.formattedOutputSchema).toBe(JSON.stringify(outputSchema, null, 2));
  });

  it("omits output schema when not present", () => {
    const vm = deriveToolDetailViewModel({
      state: "loaded",
      data: makeToolDetail({ output_schema: undefined }),
    });

    if (vm.tag !== "loaded") throw new Error("Expected loaded");
    expect(vm.formattedOutputSchema).toBeUndefined();
  });

  it("derives grant rows with identity id and rate limit formatting", () => {
    const vm = deriveToolDetailViewModel({
      state: "loaded",
      data: makeToolDetail({
        grants: [
          { identity_id: "i1", identity_name: "Alice", max_calls_per_hour: 100, granted_at: "2026-01-01" },
          { identity_id: "i2", identity_name: "Bob", granted_at: "2026-01-02" },
        ],
      }),
    });

    if (vm.tag !== "loaded") throw new Error("Expected loaded");
    expect(vm.grantRows.length).toBe(2);
    expect(vm.grantRows[0].identityId).toBe("i1");
    expect(vm.grantRows[0].rateLimitDisplay).toBe("100/hr");
    expect(vm.grantRows[1].identityId).toBe("i2");
    expect(vm.grantRows[1].rateLimitDisplay).toBe("Unlimited");
    expect(vm.showEmptyGrants).toBe(false);
  });

  it("shows empty grants when none configured", () => {
    const vm = deriveToolDetailViewModel({
      state: "loaded",
      data: makeToolDetail({ grants: [] }),
    });

    if (vm.tag !== "loaded") throw new Error("Expected loaded");
    expect(vm.showEmptyGrants).toBe(true);
  });

  it("derives governance rows with optional number formatting", () => {
    const vm = deriveToolDetailViewModel({
      state: "loaded",
      data: makeToolDetail({
        governance_policies: [
          { policy_title: "Rate Policy", policy_status: "active", max_per_call: 5, max_per_day: 100 },
          { policy_title: "Audit Policy", policy_status: "active" },
        ],
      }),
    });

    if (vm.tag !== "loaded") throw new Error("Expected loaded");
    expect(vm.governanceRows.length).toBe(2);
    expect(vm.governanceRows[0].maxPerCallDisplay).toBe("5");
    expect(vm.governanceRows[0].maxPerDayDisplay).toBe("100");
    expect(vm.governanceRows[1].maxPerCallDisplay).toBe("--");
    expect(vm.governanceRows[1].conditionsDisplay).toBe("None");
    expect(vm.showEmptyGovernance).toBe(false);
  });
});

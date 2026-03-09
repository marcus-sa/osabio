import { describe, expect, it } from "bun:test";
import { resolveIdentityAttributionPatch } from "../../app/src/server/extraction/identity-resolution";

describe("person attribution mapping", () => {
  it("maps known people to record-reference fields", () => {
    const patch = resolveIdentityAttributionPatch({
      targetKind: "decision",
      assigneeName: "Marcus",
      identityRecordId: "marcus",
    });

    expect(patch).toEqual({
      kind: "decision",
      field: "decided_by",
      value: "marcus",
    });
  });

  it("maps unresolved names to *_name fields", () => {
    const patch = resolveIdentityAttributionPatch({
      targetKind: "decision",
      assigneeName: "Sarah",
    });

    expect(patch).toEqual({
      kind: "decision",
      field: "decided_by_name",
      value: "Sarah",
    });
  });

  it("maps tasks to owner_name when unresolved", () => {
    const patch = resolveIdentityAttributionPatch({
      targetKind: "task",
      assigneeName: "Jordan",
    });

    expect(patch).toEqual({
      kind: "task",
      field: "owner_name",
      value: "Jordan",
    });
  });

  it("maps questions to assigned_to_name when unresolved", () => {
    const patch = resolveIdentityAttributionPatch({
      targetKind: "question",
      assigneeName: "Priya",
    });

    expect(patch).toEqual({
      kind: "question",
      field: "assigned_to_name",
      value: "Priya",
    });
  });
});

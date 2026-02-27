import { describe, expect, it } from "bun:test";
import { resolvePersonAttributionPatch } from "../../app/src/server/extraction/person";

describe("person attribution mapping", () => {
  it("maps known people to record-reference fields", () => {
    const patch = resolvePersonAttributionPatch({
      targetKind: "decision",
      assigneeName: "Marcus",
      personRecordId: "marcus",
    });

    expect(patch).toEqual({
      kind: "decision",
      field: "decided_by",
      value: "marcus",
    });
  });

  it("maps unresolved names to *_name fields", () => {
    const patch = resolvePersonAttributionPatch({
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
    const patch = resolvePersonAttributionPatch({
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
    const patch = resolvePersonAttributionPatch({
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

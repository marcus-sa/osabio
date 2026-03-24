import { describe, it, expect } from "bun:test";
import { deriveCreateGrantDialogViewModel } from "./CreateGrantDialog";

describe("deriveCreateGrantDialogViewModel", () => {
  it("maps identities to dropdown options", () => {
    const vm = deriveCreateGrantDialogViewModel({
      identities: [
        { id: "id-1", name: "Alice" },
        { id: "id-2", name: "Bob" },
      ],
      isLoading: false,
    });

    expect(vm.identityOptions).toEqual([
      { label: "Alice", value: "id-1" },
      { label: "Bob", value: "id-2" },
    ]);
    expect(vm.placeholderText).toBe("Select an identity");
    expect(vm.isLoadingIdentities).toBe(false);
  });

  it("shows loading placeholder when loading", () => {
    const vm = deriveCreateGrantDialogViewModel({
      identities: [],
      isLoading: true,
    });

    expect(vm.placeholderText).toBe("Loading identities...");
    expect(vm.isLoadingIdentities).toBe(true);
  });

  it("shows no identities placeholder when empty and not loading", () => {
    const vm = deriveCreateGrantDialogViewModel({
      identities: [],
      isLoading: false,
    });

    expect(vm.placeholderText).toBe("No identities available");
    expect(vm.identityOptions).toEqual([]);
  });
});

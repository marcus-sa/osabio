import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Clipboard mock
// ---------------------------------------------------------------------------

const writeTextMock = mock(() => Promise.resolve());
const originalClipboard = navigator.clipboard;

beforeEach(() => {
  writeTextMock.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: originalClipboard,
    writable: true,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProxyTokenDialog", () => {
  it("renders the proxy token value when open", async () => {
    const { ProxyTokenDialog } = await import("./proxy-token-dialog");
    const onClose = mock(() => {});

    render(
      <ProxyTokenDialog
        open={true}
        token="brp_test_abc123"
        agentName="Coding Agent"
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId("proxy-token-value")).toHaveTextContent("brp_test_abc123");
    expect(screen.getByText(/Coding Agent/)).toBeInTheDocument();
  });

  it("shows token-only-once warning and X-Osabio-Auth usage instruction", async () => {
    const { ProxyTokenDialog } = await import("./proxy-token-dialog");
    const onClose = mock(() => {});

    render(
      <ProxyTokenDialog
        open={true}
        token="brp_xyz"
        agentName="Test Agent"
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(screen.getByText(/X-Osabio-Auth/)).toBeInTheDocument();
  });

  it("copies token to clipboard when Copy button is clicked", async () => {
    const { ProxyTokenDialog } = await import("./proxy-token-dialog");
    const onClose = mock(() => {});

    render(
      <ProxyTokenDialog
        open={true}
        token="brp_copy_me"
        agentName="Agent"
        onClose={onClose}
      />,
    );

    const copyButton = screen.getByRole("button", { name: /copy/i });
    await userEvent.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledWith("brp_copy_me");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
    });
  });

  it("calls onClose when Done button is clicked", async () => {
    const { ProxyTokenDialog } = await import("./proxy-token-dialog");
    const onClose = mock(() => {});

    render(
      <ProxyTokenDialog
        open={true}
        token="brp_done_test"
        agentName="Agent"
        onClose={onClose}
      />,
    );

    const doneButton = screen.getByRole("button", { name: /done/i });
    await userEvent.click(doneButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

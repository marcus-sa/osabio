import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";

function Hello({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}

describe("RTL smoke", () => {
  it("renders", () => {
    render(<Hello name="world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });
});

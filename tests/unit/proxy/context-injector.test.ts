/**
 * Unit tests for brain-context XML building with workspace settings.
 *
 * Step 03-02: Proxy context injects workspace enforcement mode for agent awareness.
 *
 * Tests the pure buildBrainContextXml function:
 * - With workspace settings: produces <workspace-settings> section BEFORE decisions
 * - Without workspace settings: backwards compatible (no <workspace-settings> section)
 * - With workspace settings but no candidates: produces workspace-settings-only XML
 */
import { describe, expect, it } from "bun:test";
import {
  buildBrainContextXml,
  type RankedCandidate,
} from "../../../app/src/server/proxy/context-injector";

// ---------------------------------------------------------------------------
// buildBrainContextXml with workspace settings
// ---------------------------------------------------------------------------

describe("buildBrainContextXml with workspace settings", () => {
  const decision: RankedCandidate = {
    id: "d-1",
    type: "decision",
    text: "Use tRPC for all APIs",
    score: 0.9,
  };

  const learning: RankedCandidate = {
    id: "l-1",
    type: "learning",
    text: "Always validate input at boundaries",
    score: 0.8,
  };

  it("includes workspace-settings section with enforcement mode when provided", () => {
    const xml = buildBrainContextXml([decision], {
      enforcementMode: "hard",
    });

    expect(xml).toContain("<workspace-settings>");
    expect(xml).toContain("<evidence-enforcement>hard</evidence-enforcement>");
    expect(xml).toContain("</workspace-settings>");
  });

  it("places workspace-settings BEFORE decisions section", () => {
    const xml = buildBrainContextXml([decision], {
      enforcementMode: "soft",
    });

    const settingsIndex = xml.indexOf("<workspace-settings>");
    const decisionsIndex = xml.indexOf("<decisions>");
    expect(settingsIndex).toBeGreaterThan(-1);
    expect(decisionsIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeLessThan(decisionsIndex);
  });

  it("supports all enforcement mode values", () => {
    for (const mode of ["bootstrap", "soft", "hard"] as const) {
      const xml = buildBrainContextXml([decision], {
        enforcementMode: mode,
      });
      expect(xml).toContain(`<evidence-enforcement>${mode}</evidence-enforcement>`);
    }
  });

  it("omits workspace-settings section when no settings provided", () => {
    const xml = buildBrainContextXml([decision]);

    expect(xml).not.toContain("<workspace-settings>");
    expect(xml).not.toContain("<evidence-enforcement>");
    expect(xml).toContain("<decisions>");
  });

  it("omits workspace-settings section when settings object has no enforcementMode", () => {
    const xml = buildBrainContextXml([decision], {});

    expect(xml).not.toContain("<workspace-settings>");
    expect(xml).not.toContain("<evidence-enforcement>");
  });

  it("returns empty string when no candidates and no settings", () => {
    const xml = buildBrainContextXml([]);
    expect(xml).toBe("");
  });

  it("produces workspace-settings-only XML when settings present but no candidates", () => {
    const xml = buildBrainContextXml([], {
      enforcementMode: "hard",
    });

    expect(xml).toContain("<brain-context>");
    expect(xml).toContain("<workspace-settings>");
    expect(xml).toContain("<evidence-enforcement>hard</evidence-enforcement>");
    expect(xml).not.toContain("<decisions>");
    expect(xml).not.toContain("<learnings>");
    expect(xml).not.toContain("<observations>");
  });

  it("produces complete XML with settings and all candidate types", () => {
    const observation: RankedCandidate = {
      id: "o-1",
      type: "observation",
      text: "API latency increasing",
      score: 0.7,
    };

    const xml = buildBrainContextXml([decision, learning, observation], {
      enforcementMode: "soft",
    });

    expect(xml).toContain("<brain-context>");
    expect(xml).toContain("<workspace-settings>");
    expect(xml).toContain("<evidence-enforcement>soft</evidence-enforcement>");
    expect(xml).toContain("<decisions>");
    expect(xml).toContain("<learnings>");
    expect(xml).toContain("<observations>");
    expect(xml).toContain("</brain-context>");
  });
});

// ---------------------------------------------------------------------------
// CachedCandidatePool type with enforcementMode
// ---------------------------------------------------------------------------

describe("CachedCandidatePool with enforcementMode", () => {
  it("accepts optional enforcementMode field", () => {
    // This is a compile-time type test -- if it compiles, the type is correct.
    // We import and construct a CachedCandidatePool to verify the type accepts the field.
    const { createContextCache } = require("../../../app/src/server/proxy/context-cache") as typeof import("../../../app/src/server/proxy/context-cache");

    const cache = createContextCache(60);
    const pool = {
      decisions: [],
      learnings: [],
      observations: [],
      populatedAt: Date.now(),
      enforcementMode: "hard" as const,
    };

    // Should not throw -- type must accept the field
    cache.set("ws-1", pool);
    const retrieved = cache.get("ws-1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.enforcementMode).toBe("hard");
  });

  it("works without enforcementMode field (backwards compatible)", () => {
    const { createContextCache } = require("../../../app/src/server/proxy/context-cache") as typeof import("../../../app/src/server/proxy/context-cache");

    const cache = createContextCache(60);
    const pool = {
      decisions: [],
      learnings: [],
      observations: [],
      populatedAt: Date.now(),
    };

    cache.set("ws-2", pool);
    const retrieved = cache.get("ws-2");
    expect(retrieved).toBeDefined();
    expect(retrieved!.enforcementMode).toBeUndefined();
  });
});

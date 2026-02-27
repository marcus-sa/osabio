import { describe, expect, it } from "bun:test";
import { buildSuggestionGroundingAnchors, filterGroundedSuggestions } from "../../app/src/server/onboarding/onboarding-reply";

describe("onboarding suggestion grounding", () => {
  it("builds grounding anchors from entities, tools, and latest user terms", () => {
    const anchors = buildSuggestionGroundingAnchors({
      latestEntities: [
        { kind: "project", text: "Brain Platform", confidence: 0.98 },
        { kind: "feature", text: "cross-project conflict detection", confidence: 0.96 },
      ],
      latestTools: ["SurrealDB", "GitHub"],
      latestUserText: "We run strict schemafull SurrealDB and need conflict escalation workflows.",
    });

    expect(anchors.some((value) => value.value === "Brain Platform")).toBe(true);
    expect(anchors.some((value) => value.value === "SurrealDB")).toBe(true);
    expect(anchors.some((value) => value.value.toLowerCase().includes("conflict"))).toBe(true);
    expect(anchors.some((value) => value.value.toLowerCase().includes("schemafull"))).toBe(true);
  });

  it("drops generic suggestions and keeps only grounded suggestions", () => {
    const filtered = filterGroundedSuggestions({
      suggestions: [
        "List key team members",
        "What scalability requirements do you have for SurrealDB?",
        "Should we prioritize GitHub commit awareness in this project?",
        "What scalability requirements do you have for SurrealDB?",
      ],
      anchors: [
        { value: "SurrealDB", normalized: "surrealdb", source: "tool" },
        { value: "GitHub", normalized: "github", source: "tool" },
        { value: "AI-native business management platform", normalized: "ai native business management platform", source: "entity" },
      ],
    });

    expect(filtered).toEqual([
      "What scalability requirements do you have for SurrealDB?",
      "Should we prioritize GitHub commit awareness in this project?",
    ]);
  });

  it("supports clarifying suggestions grounded in latest user message terms", () => {
    const anchors = buildSuggestionGroundingAnchors({
      latestEntities: [],
      latestTools: [],
      latestUserText: "We still need retention policies for audit logs across projects.",
    });

    const filtered = filterGroundedSuggestions({
      suggestions: [
        "What retention period should audit logs keep?",
        "Describe current projects",
      ],
      anchors,
    });

    expect(filtered).toEqual(["What retention period should audit logs keep?"]);
  });

  it("returns no suggestions when no grounding anchors exist", () => {
    const anchors = buildSuggestionGroundingAnchors({
      latestEntities: [],
      latestTools: [],
      latestUserText: "and the with for",
    });

    const filtered = filterGroundedSuggestions({
      suggestions: [
        "What should we capture next?",
      ],
      anchors,
    });

    expect(anchors).toEqual([]);
    expect(filtered).toEqual([]);
  });

  it("blocks known generic templates even when anchor overlap exists", () => {
    const filtered = filterGroundedSuggestions({
      suggestions: [
        "Describe current projects for SurrealDB rollout",
        "What scalability constraints should SurrealDB handle first?",
      ],
      anchors: [
        { value: "SurrealDB", normalized: "surrealdb", source: "tool" },
        { value: "projects", normalized: "projects", source: "user_term" },
      ],
    });

    expect(filtered).toEqual(["What scalability constraints should SurrealDB handle first?"]);
  });
});

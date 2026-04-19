import { describe, expect, test } from "bun:test";
import { planFileSchema } from "./runner";

describe("planFileSchema", () => {
  test("parses legacy shape (no status field) as ready", () => {
    const legacy = {
      summary: "Rename foo to bar",
      items: [
        {
          task: "Rename foo to bar in utils.ts",
          repoOwner: "acme",
          repoName: "core",
          baseBranch: "main",
          origin: "legacy",
        },
      ],
    };
    const parsed = planFileSchema.parse(legacy);
    if (parsed.status === "clarify") {
      throw new Error("expected ready plan");
    }
    expect(parsed.summary).toBe("Rename foo to bar");
    expect(parsed.items).toHaveLength(1);
  });

  test("parses new ready shape with explicit status", () => {
    const ready = {
      status: "ready" as const,
      summary: "Do the thing",
      items: [
        {
          task: "thing",
          repoOwner: "a",
          repoName: "b",
          baseBranch: "main",
          origin: "plan",
        },
      ],
    };
    const parsed = planFileSchema.parse(ready);
    expect(parsed.status).toBe("ready");
  });

  test("parses clarify shape with questions", () => {
    const clarify = {
      status: "clarify" as const,
      questions: [
        { id: "q1", question: "What framework?" },
        {
          id: "q2",
          question: "Which repo?",
          options: ["api", "web"],
          why: "affects where the code lands",
        },
      ],
      reason: "need scoping",
    };
    const parsed = planFileSchema.parse(clarify);
    expect(parsed.status).toBe("clarify");
    if (parsed.status === "clarify") {
      expect(parsed.questions).toHaveLength(2);
    }
  });

  test("rejects clarify with zero questions", () => {
    expect(() =>
      planFileSchema.parse({ status: "clarify", questions: [] }),
    ).toThrow();
  });
});

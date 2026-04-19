import { describe, expect, test } from "bun:test";
import { buildWorkBranch } from "./branch-name";

describe("buildWorkBranch", () => {
  test("slugifies short tasks", () => {
    expect(buildWorkBranch("Add login feature", "abc123xyz")).toBe(
      "machina/add-login-feature-abc123",
    );
  });

  test("truncates long tasks at a word boundary", () => {
    const task =
      "Create a new Machina template called project-status-digest scoped to this project";
    const branch = buildWorkBranch(task, "xyz789abc");
    expect(branch.startsWith("machina/")).toBe(true);
    expect(branch.endsWith("-xyz789")).toBe(true);
    const slug = branch.replace(/^machina\//, "").replace(/-xyz789$/, "");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  test("strips non-alphanumerics and collapses dashes", () => {
    expect(buildWorkBranch("Fix: `foo.bar` (v2) —> baz!", "id12345")).toBe(
      "machina/fix-foo-bar-v2-baz-id1234",
    );
  });

  test("falls back to id-only when task has no usable characters", () => {
    expect(buildWorkBranch("!!!", "id12345")).toBe("machina/id1234");
    expect(buildWorkBranch("", "id12345")).toBe("machina/id1234");
  });

  test("appends a 6-char suffix for uniqueness", () => {
    const a = buildWorkBranch("same task", "aaaaaaaa");
    const b = buildWorkBranch("same task", "bbbbbbbb");
    expect(a).not.toBe(b);
    expect(a).toBe("machina/same-task-aaaaaa");
    expect(b).toBe("machina/same-task-bbbbbb");
  });
});

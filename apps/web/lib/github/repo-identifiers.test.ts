import { describe, expect, test } from "bun:test";

import { isValidGitHubRepoName, isValidGitHubRepoOwner } from "./urls";

describe("repo-identifiers", () => {
  test("accepts safe GitHub owner and repo segments", () => {
    expect(isValidGitHubRepoOwner("vercel")).toBe(true);
    expect(isValidGitHubRepoOwner("vercel-labs")).toBe(true);
    expect(isValidGitHubRepoName("open-agents")).toBe(true);
    expect(isValidGitHubRepoName("open_agents.v2")).toBe(true);
  });

  test("rejects unsafe GitHub owner and repo segments", () => {
    expect(isValidGitHubRepoOwner('vercel" && echo nope && "')).toBe(false);
    expect(isValidGitHubRepoName("open harness")).toBe(false);
  });
});

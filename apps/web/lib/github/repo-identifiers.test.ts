import { describe, expect, test } from "bun:test";

import {
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
  parseGitHubHttpsUrl,
  parseGitHubUrl,
} from "./urls";

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

  test("parses only real github.com HTTPS repo URLs", () => {
    expect(
      parseGitHubHttpsUrl("https://github.com/vercel/open-agents.git"),
    ).toEqual({ owner: "vercel", repo: "open-agents" });
    expect(
      parseGitHubHttpsUrl("https://attacker.example/github.com/vercel/repo"),
    ).toBeNull();
    expect(parseGitHubHttpsUrl("http://github.com/vercel/repo")).toBeNull();
    expect(
      parseGitHubHttpsUrl("https://github.com/vercel/repo/extra"),
    ).toBeNull();
  });

  test("parses SSH GitHub URLs without accepting arbitrary hosts", () => {
    expect(parseGitHubUrl("git@github.com:vercel/open-agents.git")).toEqual({
      owner: "vercel",
      repo: "open-agents",
    });
    expect(
      parseGitHubUrl("git@attacker.example:github.com/vercel/repo.git"),
    ).toBeNull();
  });
});

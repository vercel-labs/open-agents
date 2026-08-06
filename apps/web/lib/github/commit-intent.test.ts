import { describe, expect, mock, test } from "bun:test";

mock.module("./users", () => ({
  getGitHubUserProfile: async () => null,
}));

const { getRepoRelativePathError } = await import("./commit-intent");
const { buildCommitMessageWithCoAuthor } = await import("./commit");

describe("commit intent path validation", () => {
  test("accepts normal repo-relative paths", () => {
    expect(getRepoRelativePathError("src/app.ts")).toBeNull();
    expect(getRepoRelativePathError("docs/readme.md")).toBeNull();
  });

  test("rejects unsafe paths", () => {
    expect(getRepoRelativePathError("/tmp/file")).toBe(
      "Path must be repo-relative",
    );
    expect(getRepoRelativePathError("../secret")).toBe(
      "Path contains an unsupported segment",
    );
    expect(getRepoRelativePathError(".git/config")).toBe(
      "Path contains an unsupported segment",
    );
    expect(getRepoRelativePathError("src//app.ts")).toBe(
      "Path contains an unsupported segment",
    );
  });
});

describe("commit message attribution", () => {
  test("adds co-author trailer when user attribution is provided", () => {
    expect(
      buildCommitMessageWithCoAuthor("docs: update readme", {
        name: "octocat",
        email: "12345+octocat@users.noreply.github.com",
      }),
    ).toBe(
      "docs: update readme\n\nCo-Authored-By: octocat <12345+octocat@users.noreply.github.com>",
    );
  });

  test("leaves commit message unchanged without user attribution", () => {
    expect(buildCommitMessageWithCoAuthor("docs: update readme")).toBe(
      "docs: update readme",
    );
  });
});

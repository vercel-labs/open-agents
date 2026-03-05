import { describe, expect, test } from "bun:test";
import {
  getPrDeploymentRefreshInterval,
  PR_DEPLOYMENT_ACTIVE_POLL_MS,
  PR_DEPLOYMENT_BACKGROUND_POLL_MS,
} from "./pr-deployment-polling";

describe("pr deployment polling", () => {
  test("stops polling when no PR exists", () => {
    expect(
      getPrDeploymentRefreshInterval({
        hasExistingPr: false,
        deploymentUrl: null,
        documentHasFocus: true,
      }),
    ).toBe(0);
  });

  test("stops polling once deployment url exists", () => {
    expect(
      getPrDeploymentRefreshInterval({
        hasExistingPr: true,
        deploymentUrl: "https://preview.example.com",
        documentHasFocus: true,
      }),
    ).toBe(0);
  });

  test("uses active poll interval when page is focused", () => {
    expect(
      getPrDeploymentRefreshInterval({
        hasExistingPr: true,
        deploymentUrl: null,
        documentHasFocus: true,
      }),
    ).toBe(PR_DEPLOYMENT_ACTIVE_POLL_MS);
  });

  test("uses background poll interval when page is not focused", () => {
    expect(
      getPrDeploymentRefreshInterval({
        hasExistingPr: true,
        deploymentUrl: null,
        documentHasFocus: false,
      }),
    ).toBe(PR_DEPLOYMENT_BACKGROUND_POLL_MS);
  });
});

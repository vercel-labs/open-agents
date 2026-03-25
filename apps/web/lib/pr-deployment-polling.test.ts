import { describe, expect, test } from "bun:test";
import {
  getPrDeploymentRefreshInterval,
  PR_DEPLOYMENT_ACTIVE_POLL_MS,
  PR_DEPLOYMENT_BACKGROUND_POLL_MS,
} from "./pr-deployment-polling";

describe("pr deployment polling", () => {
  test("stops polling when preview lookup is disabled", () => {
    expect(
      getPrDeploymentRefreshInterval({
        shouldPoll: false,
        deploymentUrl: null,
        documentHasFocus: true,
      }),
    ).toBe(0);
  });

  test("stops polling once deployment url exists", () => {
    expect(
      getPrDeploymentRefreshInterval({
        shouldPoll: true,
        deploymentUrl: "https://preview.example.com",
        documentHasFocus: true,
      }),
    ).toBe(0);
  });

  test("keeps polling while waiting for the first deployment after a push", () => {
    expect(
      getPrDeploymentRefreshInterval({
        shouldPoll: true,
        deploymentUrl: null,
        documentHasFocus: true,
        waitForDeploymentUrlChangeFrom: null,
      }),
    ).toBe(PR_DEPLOYMENT_ACTIVE_POLL_MS);
  });

  test("keeps polling while the latest deployment url still matches the stale preview", () => {
    expect(
      getPrDeploymentRefreshInterval({
        shouldPoll: true,
        deploymentUrl: "https://preview-old.example.com",
        documentHasFocus: false,
        waitForDeploymentUrlChangeFrom: "https://preview-old.example.com",
      }),
    ).toBe(PR_DEPLOYMENT_BACKGROUND_POLL_MS);
  });

  test("stops polling once a newer deployment url replaces the stale preview", () => {
    expect(
      getPrDeploymentRefreshInterval({
        shouldPoll: true,
        deploymentUrl: "https://preview-new.example.com",
        documentHasFocus: true,
        waitForDeploymentUrlChangeFrom: "https://preview-old.example.com",
      }),
    ).toBe(0);
  });

  test("uses active poll interval when page is focused", () => {
    expect(
      getPrDeploymentRefreshInterval({
        shouldPoll: true,
        deploymentUrl: null,
        documentHasFocus: true,
      }),
    ).toBe(PR_DEPLOYMENT_ACTIVE_POLL_MS);
  });

  test("uses background poll interval when page is not focused", () => {
    expect(
      getPrDeploymentRefreshInterval({
        shouldPoll: true,
        deploymentUrl: null,
        documentHasFocus: false,
      }),
    ).toBe(PR_DEPLOYMENT_BACKGROUND_POLL_MS);
  });
});

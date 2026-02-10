import { z } from "zod";
import {
  deleteInstallationsNotInList,
  upsertInstallation,
} from "@/lib/db/installations";

const userInstallationSchema = z.object({
  id: z.number(),
  repository_selection: z.enum(["all", "selected"]),
  html_url: z.string().url().nullable().optional(),
  account: z.object({
    login: z.string(),
    type: z.string(),
  }),
});

const userInstallationsResponseSchema = z.object({
  installations: z.array(userInstallationSchema),
});

function normalizeAccountType(type: string): "User" | "Organization" {
  return type === "Organization" ? "Organization" : "User";
}

async function fetchUserInstallations(userToken: string) {
  const response = await fetch("https://api.github.com/user/installations", {
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Failed to fetch GitHub installations: ${response.status} ${responseText}`,
    );
  }

  const json = await response.json();
  const parsed = userInstallationsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid GitHub installations response");
  }

  return parsed.data.installations;
}

export async function syncUserInstallations(
  userId: string,
  userToken: string,
): Promise<number> {
  const installations = await fetchUserInstallations(userToken);

  for (const installation of installations) {
    await upsertInstallation({
      userId,
      installationId: installation.id,
      accountLogin: installation.account.login,
      accountType: normalizeAccountType(installation.account.type),
      repositorySelection: installation.repository_selection,
      installationUrl: installation.html_url ?? null,
    });
  }

  await deleteInstallationsNotInList(
    userId,
    installations.map((installation) => installation.id),
  );

  return installations.length;
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isManagedTemplateTrialUser } from "@/lib/managed-template-trial";
import { getServerSession } from "@/lib/session/get-server-session";
import { needsOnboarding } from "@/lib/onboarding";
import { GetStartedFlow } from "./get-started-flow";

export const metadata: Metadata = {
  title: "Get Started",
  description: "Set up your Open Agents workspace.",
};

interface GetStartedPageProps {
  searchParams: Promise<{
    step?: string | string[];
  }>;
}

function getSingleSearchParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") {
    return value;
  }

  return null;
}

export default async function GetStartedPage({
  searchParams,
}: GetStartedPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const resolvedSearchParams = await searchParams;
  const requestedStep = getSingleSearchParam(resolvedSearchParams.step);
  const requestHost = (await headers()).get("host") ?? "";

  if (isManagedTemplateTrialUser(session, requestHost)) {
    redirect("/sessions");
  }

  const onboarding = await needsOnboarding(session.user.id);

  if (!onboarding && requestedStep !== "github") {
    redirect("/sessions");
  }

  return <GetStartedFlow />;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { needsOnboarding } from "@/lib/onboarding";
import { GetStartedFlow } from "./get-started-flow";

export const metadata: Metadata = {
  title: "Get Started",
  description: "Set up your Open Agents workspace.",
};

export default async function GetStartedPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const onboarding = await needsOnboarding(session.user.id);
  if (!onboarding) {
    redirect("/sessions");
  }

  return <GetStartedFlow />;
}

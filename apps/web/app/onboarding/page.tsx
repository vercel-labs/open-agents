import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Get Started",
  description: "Set up your Open Agents workspace in a few quick steps.",
};

export default async function OnboardingPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect(
      `/api/auth/signin/vercel?next=${encodeURIComponent("/onboarding")}`,
    );
  }

  return <OnboardingFlow />;
}

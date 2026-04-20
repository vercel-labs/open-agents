import { redirect } from "next/navigation";
import { needsOnboarding } from "@/lib/onboarding";
import { getServerSession } from "@/lib/session/get-server-session";
import { HomePage } from "./home-page";

export default async function Home() {
  const session = await getServerSession();
  if (session?.user) {
    if (await needsOnboarding(session.user.id)) {
      redirect("/get-started");
    }
    redirect("/sessions");
  }

  return <HomePage hasSessionCookie={false} lastRepo={null} />;
}

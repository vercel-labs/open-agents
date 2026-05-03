import { redirect } from "next/navigation";
import { redirectManagedTemplateUser } from "@/lib/managed-template-page-access";
import { getServerSession } from "@/lib/session/get-server-session";
import { HomePage } from "./home-page";

export default async function Home() {
  const session = await getServerSession();
  if (session?.user) {
    await redirectManagedTemplateUser(session);
    redirect("/sessions");
  }

  return <HomePage hasSessionCookie={false} lastRepo={null} />;
}

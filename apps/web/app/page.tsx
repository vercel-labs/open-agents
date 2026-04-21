import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { HomePage } from "./home-page";

export default async function Home() {
  const session = await getServerSession();
  if (session?.user) {
    redirect("/sessions");
  }

  return <HomePage hasSessionCookie={false} lastRepo={null} />;
}

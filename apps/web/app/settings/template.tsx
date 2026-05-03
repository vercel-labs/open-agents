import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { redirectManagedTemplateUser } from "@/lib/managed-template-page-access";
import { getServerSession } from "@/lib/session/get-server-session";

type SettingsTemplateProps = {
  children: ReactNode;
};

export default async function SettingsTemplate({
  children,
}: SettingsTemplateProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }
  await redirectManagedTemplateUser(session);

  return <>{children}</>;
}

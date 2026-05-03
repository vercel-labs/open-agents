import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  MANAGED_TEMPLATE_DEPLOY_YOUR_OWN_PATH,
  shouldRedirectManagedTemplateUser,
} from "@/lib/managed-template-access";
import type { Session } from "@/lib/session/types";

export async function redirectManagedTemplateUser(
  session: Pick<Session, "user"> | null | undefined,
) {
  if (!session?.user) {
    return;
  }

  const requestHost = (await headers()).get("host") ?? "";
  if (shouldRedirectManagedTemplateUser(session, requestHost)) {
    redirect(MANAGED_TEMPLATE_DEPLOY_YOUR_OWN_PATH);
  }
}

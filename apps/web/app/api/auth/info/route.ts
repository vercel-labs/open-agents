import type { NextRequest } from "next/server";
import { hasGitHubAccount as checkGitHubLinked } from "@/lib/github/users";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { isUserAdmin, userExists } from "@/lib/db/users";
import {
  MANAGED_TEMPLATE_DEPLOY_YOUR_OWN_PATH,
  shouldRedirectManagedTemplateUser,
} from "@/lib/managed-template-access";
import { getSessionFromReq } from "@/lib/session/server";
import type { SessionUserInfo } from "@/lib/session/types";

const UNAUTHENTICATED: SessionUserInfo = { user: undefined };

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);

  if (!session?.user?.id) {
    return Response.json(UNAUTHENTICATED);
  }

  if (shouldRedirectManagedTemplateUser(session, req.url)) {
    return Response.json({
      user: undefined,
      managedTemplateAccessDenied: true,
      accessDeniedRedirect: MANAGED_TEMPLATE_DEPLOY_YOUR_OWN_PATH,
    });
  }

  // run the user-existence check in parallel with the github queries
  // so there is zero added latency on the happy path.
  const [exists, hasGitHubAccount, installations, isAdmin] = await Promise.all([
    userExists(session.user.id),
    checkGitHubLinked(session.user.id),
    getInstallationsByUserId(session.user.id),
    isUserAdmin(session.user.id),
  ]);

  if (!exists) {
    return Response.json(UNAUTHENTICATED);
  }
  const hasGitHubInstallations = installations.length > 0;
  const hasGitHub = hasGitHubAccount || hasGitHubInstallations;

  const data: SessionUserInfo = {
    user: session.user,
    authProvider: session.authProvider,
    isAdmin,
    hasGitHub,
    hasGitHubAccount,
    hasGitHubInstallations,
  };

  return Response.json(data);
}

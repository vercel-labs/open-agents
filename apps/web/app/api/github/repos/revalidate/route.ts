import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getGitHubReposCacheTag } from "@/lib/github/cached-api";
import { getServerSession } from "@/lib/session/get-server-session";

export async function POST() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const cacheTag = getGitHubReposCacheTag(session.user.id);
  revalidateTag(cacheTag, { expire: 0 });

  return NextResponse.json({ success: true, revalidated: cacheTag });
}

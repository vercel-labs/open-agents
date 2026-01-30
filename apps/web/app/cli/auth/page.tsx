import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { CLIAuthPage } from "./cli-auth-page";

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const store = await cookies();
  const hasSessionCookie = Boolean(store.get(SESSION_COOKIE_NAME)?.value);
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const codeParam = resolvedSearchParams?.code;
  const initialCode = typeof codeParam === "string" ? codeParam : "";

  return (
    <CLIAuthPage
      hasSessionCookie={hasSessionCookie}
      initialCode={initialCode}
    />
  );
}

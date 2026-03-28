import { Suspense } from "react";
import { AccountsSection, AccountsSectionSkeleton } from "../accounts-section";

export default function AccountsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Connected Accounts</h1>
      <Suspense fallback={<AccountsSectionSkeleton />}>
        <AccountsSection />
      </Suspense>
    </>
  );
}

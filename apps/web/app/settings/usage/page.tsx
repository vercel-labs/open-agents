import type { Metadata } from "next";
import { UsageSection } from "../usage-section";

export const metadata: Metadata = {
  title: "Usage",
  description: "View token consumption and tool usage history.",
};

export default function UsagePage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Usage</h1>
      <UsageSection />
    </>
  );
}

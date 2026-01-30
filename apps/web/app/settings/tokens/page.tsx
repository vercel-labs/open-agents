import type { Metadata } from "next";
import { TokensSection } from "../tokens-section";

export const metadata: Metadata = {
  title: "Connected Clients",
  description: "Manage CLI and device connections for Open Harness.",
};

export default function TokensPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Connected Clients</h1>
      <TokensSection />
    </>
  );
}

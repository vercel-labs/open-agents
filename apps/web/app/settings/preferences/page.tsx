import type { Metadata } from "next";
import { PreferencesSection } from "../preferences-section";

export const metadata: Metadata = {
  title: "Preferences",
  description: "Adjust Open Harness preferences and behavior.",
};

export default function PreferencesPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Preferences</h1>
      <PreferencesSection />
    </>
  );
}

import type { Metadata } from "next";
import { ModelVariantsSection } from "../model-variants-section";

export const metadata: Metadata = {
  title: "Model Variants",
  description: "Create model variants with provider-specific settings.",
};

export default function ModelVariantsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Model Variants</h1>
      <ModelVariantsSection />
    </>
  );
}

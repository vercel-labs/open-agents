import type { Metadata } from "next";
import { ModelVariantsSection } from "../model-variants-section";

export const metadata: Metadata = {
  title: "Model Variants",
  description: "Create model variants with provider-specific settings.",
};

export default function ModelVariantsPage() {
  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Model Variants</h1>
        <p className="text-sm text-muted-foreground">
          Provider-specific settings use AI SDK provider options.{" "}
          <a
            href="https://ai-sdk.dev/docs/foundations/provider-options"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            View provider options docs
          </a>
          .
        </p>
      </div>
      <ModelVariantsSection />
    </>
  );
}

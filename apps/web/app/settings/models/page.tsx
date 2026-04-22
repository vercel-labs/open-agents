import type { Metadata } from "next";
import { ModelVariantsSection } from "../model-variants-section";
import { ModelPreferencesSection } from "../preferences-section";

export const metadata: Metadata = {
  title: "Models",
  description: "Configure model preferences and create model variants.",
};

export default function ModelsPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Models</h1>
        <p className="text-sm text-muted-foreground">
          Set your default models and create named variants with provider-
          specific settings.
        </p>
      </div>

      <ModelPreferencesSection />

      <div className="border-t border-border/50" />

      <ModelVariantsSection />
    </div>
  );
}

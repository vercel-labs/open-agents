import { AccountsSectionSkeleton } from "./accounts-section";
import { LeaderboardSectionSkeleton } from "./leaderboard-section";
import { ModelVariantsSectionSkeleton } from "./model-variants-section";
import {
  ModelPreferencesSectionSkeleton,
  PreferencesSectionSkeleton,
} from "./preferences-section";
import { VercelSectionSkeleton } from "./vercel-section";

function ProfilePageLoading() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Profile</h1>
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
        <div className="w-full shrink-0 lg:w-56">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 shrink-0 rounded-full bg-muted" />
              <div className="space-y-1.5">
                <div className="h-5 w-28 rounded bg-muted" />
                <div className="h-4 w-20 rounded bg-muted" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-8">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                Activity
              </h2>
            </div>
            <div className="h-[96px] w-full rounded-md bg-muted" />
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="h-28 rounded-xl bg-muted" />
            <div className="h-28 rounded-xl bg-muted" />
            <div className="h-28 rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    </>
  );
}

function ConnectionsPageLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Manage your connected accounts and integrations.
        </p>
      </div>
      <VercelSectionSkeleton />
      <AccountsSectionSkeleton />
    </div>
  );
}

function PreferencesPageLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Preferences</h1>
        <p className="text-sm text-muted-foreground">
          Adjust Open Agents preferences and behavior.
        </p>
      </div>
      <PreferencesSectionSkeleton />
    </div>
  );
}

function ModelsPageLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Models</h1>
        <p className="text-sm text-muted-foreground">
          Set your default models and create named variants with provider-
          specific settings.
        </p>
      </div>
      <ModelPreferencesSectionSkeleton />
      <div className="border-t border-border/50" />
      <ModelVariantsSectionSkeleton />
    </div>
  );
}

function LeaderboardPageLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          Internal organization leaderboard ranked by token usage.
        </p>
      </div>
      <LeaderboardSectionSkeleton />
    </div>
  );
}

export default function SettingsLoading() {
  return <ProfilePageLoading />;
}

export {
  ConnectionsPageLoading,
  LeaderboardPageLoading,
  ModelsPageLoading,
  PreferencesPageLoading,
  ProfilePageLoading,
};

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { type ThemePreference, useTheme } from "@/app/providers";
import {
  DEFAULT_SANDBOX_TYPE,
  type SandboxType,
} from "@/components/sandbox-selector-compact";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ModelCombobox } from "@/components/model-combobox";
import { useModelOptions } from "@/hooks/use-model-options";
import {
  type DiffMode,
  useUserPreferences,
} from "@/hooks/use-user-preferences";
import {
  globalSkillRefSchema,
  type GlobalSkillRef,
} from "@/lib/skills/global-skill-refs";
import {
  type ModelOption,
  getDefaultModelOptionId,
  withMissingModelOption,
} from "@/lib/model-options";

const SANDBOX_OPTIONS: Array<{ id: SandboxType; name: string }> = [
  { id: "vercel", name: "Vercel" },
];

const THEME_OPTIONS: Array<{ id: ThemePreference; name: string }> = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

const DIFF_MODE_OPTIONS: Array<{ id: DiffMode; name: string }> = [
  { id: "unified", name: "Unified" },
  { id: "split", name: "Split" },
];

function isThemePreference(value: string): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

function getGlobalSkillRefError(params: {
  source: string;
  skillName: string;
  existingRefs: GlobalSkillRef[];
}): string | null {
  const parsedRef = globalSkillRefSchema.safeParse({
    source: params.source,
    skillName: params.skillName,
  });

  if (!parsedRef.success) {
    return parsedRef.error.issues[0]?.message ?? "Invalid global skill ref";
  }

  const duplicateExists = params.existingRefs.some(
    (ref) =>
      ref.source.toLowerCase() === parsedRef.data.source.toLowerCase() &&
      ref.skillName.toLowerCase() === parsedRef.data.skillName.toLowerCase(),
  );

  return duplicateExists ? "That global skill has already been added" : null;
}

export function PreferencesSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Preferences</CardTitle>
        <CardDescription>
          Default settings for new sessions. You can override these when
          starting a session or chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2">
          <Label htmlFor="appearance">Appearance</Label>
          <Select disabled>
            <SelectTrigger id="appearance" className="w-full max-w-xs">
              <Skeleton className="h-4 w-24" />
            </SelectTrigger>
          </Select>
          <p className="text-xs text-muted-foreground">
            Choose between light and dark mode.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="model">Default Model</Label>
          <Select disabled>
            <SelectTrigger id="model" className="w-full max-w-xs">
              <Skeleton className="h-4 w-32" />
            </SelectTrigger>
          </Select>
          <p className="text-xs text-muted-foreground">
            The AI model used for new chats.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sandbox">Default Sandbox</Label>
          <Select disabled>
            <SelectTrigger id="sandbox" className="w-full max-w-xs">
              <Skeleton className="h-4 w-28" />
            </SelectTrigger>
          </Select>
          <p className="text-xs text-muted-foreground">
            The execution environment for new sessions.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="diff-mode">Default Diff Mode</Label>
          <Select disabled>
            <SelectTrigger id="diff-mode" className="w-full max-w-xs">
              <Skeleton className="h-4 w-24" />
            </SelectTrigger>
          </Select>
          <p className="text-xs text-muted-foreground">
            The diff layout used when opening the changes viewer.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PreferencesSection() {
  const { theme, setTheme } = useTheme();
  const { preferences, loading, updatePreferences } = useUserPreferences();
  const { modelOptions, loading: modelOptionsLoading } = useModelOptions();
  const [isSaving, setIsSaving] = useState(false);
  const [globalSkillSource, setGlobalSkillSource] = useState("");
  const [globalSkillName, setGlobalSkillName] = useState("");
  const [globalSkillsError, setGlobalSkillsError] = useState<string | null>(
    null,
  );

  const selectedDefaultModelId =
    preferences?.defaultModelId ?? getDefaultModelOptionId(modelOptions);
  const selectedSubagentModelId = preferences?.defaultSubagentModelId ?? "auto";

  const defaultModelOptions = useMemo(
    () => withMissingModelOption(modelOptions, selectedDefaultModelId),
    [modelOptions, selectedDefaultModelId],
  );
  const subagentModelOptions = useMemo(
    () =>
      withMissingModelOption(modelOptions, preferences?.defaultSubagentModelId),
    [modelOptions, preferences?.defaultSubagentModelId],
  );

  const handleThemeChange = (nextTheme: string) => {
    if (isThemePreference(nextTheme)) {
      setTheme(nextTheme);
    }
  };

  const handleModelChange = async (modelId: string) => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultModelId: modelId });
    } catch (error) {
      console.error("Failed to update model preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubagentModelChange = async (value: string) => {
    setIsSaving(true);
    try {
      await updatePreferences({
        defaultSubagentModelId: value === "auto" ? null : value,
      });
    } catch (error) {
      console.error("Failed to update subagent model preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSandboxChange = async (sandboxType: SandboxType) => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultSandboxType: sandboxType });
    } catch (error) {
      console.error("Failed to update sandbox preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiffModeChange = async (diffMode: DiffMode) => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultDiffMode: diffMode });
    } catch (error) {
      console.error("Failed to update diff mode preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoCommitPushChange = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updatePreferences({ autoCommitPush: enabled });
    } catch (error) {
      console.error("Failed to update auto-commit preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoCreatePrChange = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updatePreferences({ autoCreatePr: enabled });
    } catch (error) {
      console.error("Failed to update auto-PR preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddGlobalSkillRef = async () => {
    const existingRefs = preferences?.globalSkillRefs ?? [];
    const errorMessage = getGlobalSkillRefError({
      source: globalSkillSource,
      skillName: globalSkillName,
      existingRefs,
    });

    if (errorMessage) {
      setGlobalSkillsError(errorMessage);
      return;
    }

    setIsSaving(true);
    setGlobalSkillsError(null);
    try {
      const nextRef = globalSkillRefSchema.parse({
        source: globalSkillSource,
        skillName: globalSkillName,
      });
      await updatePreferences({
        globalSkillRefs: [...existingRefs, nextRef],
      });
      setGlobalSkillSource("");
      setGlobalSkillName("");
    } catch (error) {
      console.error("Failed to add global skill preference:", error);
      setGlobalSkillsError("Failed to add global skill");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveGlobalSkillRef = async (index: number) => {
    const existingRefs = preferences?.globalSkillRefs ?? [];

    setIsSaving(true);
    setGlobalSkillsError(null);
    try {
      await updatePreferences({
        globalSkillRefs: existingRefs.filter(
          (_, refIndex) => refIndex !== index,
        ),
      });
    } catch (error) {
      console.error("Failed to remove global skill preference:", error);
      setGlobalSkillsError("Failed to remove global skill");
    } finally {
      setIsSaving(false);
    }
  };

  const enabledModelIds = useMemo(
    () => new Set(preferences?.enabledModelIds),
    [preferences?.enabledModelIds],
  );

  const handleAddModel = useCallback(
    async (modelId: string) => {
      const currentIds = preferences?.enabledModelIds ?? [];
      if (currentIds.includes(modelId)) return;

      setIsSaving(true);
      try {
        await updatePreferences({ enabledModelIds: [...currentIds, modelId] });
      } catch (error) {
        console.error("Failed to update enabled models:", error);
      } finally {
        setIsSaving(false);
      }
    },
    [preferences?.enabledModelIds, updatePreferences],
  );

  const handleRemoveModel = useCallback(
    async (modelId: string) => {
      const currentIds = preferences?.enabledModelIds ?? [];

      setIsSaving(true);
      try {
        await updatePreferences({
          enabledModelIds: currentIds.filter((id) => id !== modelId),
        });
      } catch (error) {
        console.error("Failed to update enabled models:", error);
      } finally {
        setIsSaving(false);
      }
    },
    [preferences?.enabledModelIds, updatePreferences],
  );

  const handleSetEnabledModels = useCallback(
    async (nextIds: string[]) => {
      setIsSaving(true);
      try {
        await updatePreferences({ enabledModelIds: nextIds });
      } catch (error) {
        console.error("Failed to update enabled models:", error);
      } finally {
        setIsSaving(false);
      }
    },
    [updatePreferences],
  );

  if (loading) {
    return <PreferencesSectionSkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Preferences</CardTitle>
        <CardDescription>
          Default settings for new sessions. You can override these when
          starting a session or chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2">
          <Label htmlFor="appearance">Appearance</Label>
          <Select value={theme} onValueChange={handleThemeChange}>
            <SelectTrigger id="appearance" className="w-full max-w-xs">
              <SelectValue placeholder="Select an appearance" />
            </SelectTrigger>
            <SelectContent>
              {THEME_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Choose between light and dark mode. This preference is saved in your
            current browser.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="model">Default Model</Label>
          <ModelCombobox
            value={selectedDefaultModelId}
            items={defaultModelOptions.map((option) => ({
              id: option.id,
              label: option.label,
              description: option.description,
              isVariant: option.isVariant,
            }))}
            placeholder="Select a model"
            searchPlaceholder="Search models..."
            emptyText={modelOptionsLoading ? "Loading..." : "No models found."}
            disabled={isSaving || modelOptionsLoading}
            onChange={handleModelChange}
          />
          <p className="text-xs text-muted-foreground">
            The AI model used for new chats.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="subagent-model">Subagent Model</Label>
          <ModelCombobox
            value={selectedSubagentModelId}
            items={[
              { id: "auto", label: "Same as main model" },
              ...subagentModelOptions.map((option) => ({
                id: option.id,
                label: option.label,
                description: option.description,
                isVariant: option.isVariant,
              })),
            ]}
            placeholder="Select a model"
            searchPlaceholder="Search models..."
            emptyText={modelOptionsLoading ? "Loading..." : "No models found."}
            disabled={isSaving || modelOptionsLoading}
            onChange={handleSubagentModelChange}
          />
          <p className="text-xs text-muted-foreground">
            The AI model used for explorer and executor subagents. Defaults to
            the main model if not set.
          </p>
        </div>

        <EnabledModelsSection
          modelOptions={modelOptions}
          modelOptionsLoading={modelOptionsLoading}
          enabledModelIds={enabledModelIds}
          onAddModel={handleAddModel}
          onRemoveModel={handleRemoveModel}
          onSetEnabledModels={handleSetEnabledModels}
          disabled={isSaving}
        />

        <div className="grid gap-2">
          <Label htmlFor="sandbox">Default Sandbox</Label>
          <Select
            value={preferences?.defaultSandboxType ?? DEFAULT_SANDBOX_TYPE}
            onValueChange={(value) => handleSandboxChange(value as SandboxType)}
            disabled={isSaving}
          >
            <SelectTrigger id="sandbox" className="w-full max-w-xs">
              <SelectValue placeholder="Select a sandbox type" />
            </SelectTrigger>
            <SelectContent>
              {SANDBOX_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The execution environment for new sessions.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="diff-mode">Default Diff Mode</Label>
          <Select
            value={preferences?.defaultDiffMode ?? "unified"}
            onValueChange={(value) => handleDiffModeChange(value as DiffMode)}
            disabled={isSaving}
          >
            <SelectTrigger id="diff-mode" className="w-full max-w-xs">
              <SelectValue placeholder="Select a diff mode" />
            </SelectTrigger>
            <SelectContent>
              {DIFF_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The diff layout used when opening the changes viewer.
          </p>
        </div>

        <div className="grid gap-3">
          <div className="space-y-1">
            <Label>Global Skills</Label>
            <p className="text-xs text-muted-foreground">
              Skills from GitHub installed outside the repo for every new
              session. Repo skills with the same name take precedence.
            </p>
          </div>

          {(preferences?.globalSkillRefs ?? []).length > 0 ? (
            <div className="divide-y divide-border/60 rounded-lg border border-border/70">
              {(preferences?.globalSkillRefs ?? []).map(
                (globalSkillRef, index) => (
                  <div
                    key={`${globalSkillRef.source}-${globalSkillRef.skillName}`}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {globalSkillRef.skillName}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {globalSkillRef.source}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveGlobalSkillRef(index)}
                      disabled={isSaving}
                      aria-label={`Remove ${globalSkillRef.skillName}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No global skills configured yet.
            </p>
          )}

          <div className="grid gap-2.5 rounded-lg border border-dashed border-border/60 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="global-skill-source"
                  className="text-xs font-medium"
                >
                  Repository source
                </Label>
                <Input
                  id="global-skill-source"
                  value={globalSkillSource}
                  onChange={(event) => setGlobalSkillSource(event.target.value)}
                  placeholder="vercel/ai"
                  disabled={isSaving}
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="global-skill-name"
                  className="text-xs font-medium"
                >
                  Skill name
                </Label>
                <Input
                  id="global-skill-name"
                  value={globalSkillName}
                  onChange={(event) => setGlobalSkillName(event.target.value)}
                  placeholder="ai-sdk"
                  disabled={isSaving}
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleAddGlobalSkillRef}
                disabled={isSaving}
              >
                <Plus />
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the GitHub <code>owner/repo</code> source and the skill
              name, e.g. <code>vercel/ai</code> + <code>ai-sdk</code>.
            </p>
            {globalSkillsError && (
              <p className="text-xs text-destructive">{globalSkillsError}</p>
            )}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="auto-commit-push">Auto commit and push</Label>
              <p className="text-xs text-muted-foreground">
                Automatically commit and push git changes when an agent turn
                finishes.
              </p>
            </div>
            <Switch
              id="auto-commit-push"
              checked={preferences?.autoCommitPush ?? false}
              onCheckedChange={handleAutoCommitPushChange}
              disabled={isSaving}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="auto-create-pr">Auto create pull request</Label>
              <p className="text-xs text-muted-foreground">
                Automatically open a pull request after auto commit and push for
                repo-backed sessions.
              </p>
            </div>
            <Switch
              id="auto-create-pr"
              checked={preferences?.autoCreatePr ?? false}
              onCheckedChange={handleAutoCreatePrChange}
              disabled={isSaving || !(preferences?.autoCommitPush ?? false)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EnabledModelsSection({
  modelOptions,
  modelOptionsLoading,
  enabledModelIds,
  onAddModel,
  onRemoveModel,
  onSetEnabledModels,
  disabled,
}: {
  modelOptions: ModelOption[];
  modelOptionsLoading: boolean;
  enabledModelIds: Set<string>;
  onAddModel: (modelId: string) => void;
  onRemoveModel: (modelId: string) => void;
  onSetEnabledModels: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const enabledCount = enabledModelIds.size;

  const enabledOptions = useMemo(
    () => modelOptions.filter((option) => enabledModelIds.has(option.id)),
    [modelOptions, enabledModelIds],
  );

  const availableOptions = useMemo(() => {
    const opts = modelOptions.filter(
      (option) => !enabledModelIds.has(option.id),
    );
    if (!search.trim()) return opts;
    const lower = search.toLowerCase();
    return opts.filter(
      (option) =>
        option.label.toLowerCase().includes(lower) ||
        option.id.toLowerCase().includes(lower) ||
        (option.description?.toLowerCase().includes(lower) ?? false),
    );
  }, [modelOptions, enabledModelIds, search]);

  const handleDeselectAll = () => {
    onSetEnabledModels([]);
  };

  const handleAdd = (modelId: string) => {
    onAddModel(modelId);
    setSearch("");
    inputRef.current?.focus();
  };

  if (modelOptionsLoading) {
    return (
      <div className="grid gap-2">
        <Label>Custom Model Set</Label>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label>Custom Model Set</Label>
          {enabledCount > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleDeselectAll}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-40"
            >
              Clear all
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {enabledCount === 0
            ? "By default, every available model is shown in the model selector. Add models here to create a shortlist of just the ones you use."
            : `The model selector will only show ${enabledCount === 1 ? "this model" : `these ${enabledCount} models`}. Remove all to go back to showing every model.`}
        </p>
      </div>

      {enabledOptions.length > 0 && (
        <div className="divide-y divide-border/60 rounded-lg border border-border/70">
          {enabledOptions.map((option) => (
            <div key={option.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {option.label}
                  </span>
                  {option.isVariant && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      variant
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {option.id}
                </p>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemoveModel(option.id)}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                aria-label={`Remove ${option.label}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            placeholder="Search to add a model..."
            disabled={disabled}
            className="pl-9"
          />
        </div>
        {dropdownOpen && (
          <>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop dismiss */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => {
                setDropdownOpen(false);
                setSearch("");
              }}
            />
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
              <div className="max-h-60 overflow-y-auto">
                {availableOptions.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {search.trim()
                      ? "No matching models."
                      : "All models have been added."}
                  </p>
                ) : (
                  availableOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleAdd(option.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                    >
                      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {option.label}
                          </span>
                          {option.isVariant && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                              variant
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {option.description ?? option.id}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { ExternalLink, Check, Loader2, FolderGit2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { Session } from "@/lib/db/schema";

interface CreateRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  hasSandbox: boolean;
  onRepoCreated?: (result: {
    repoUrl: string;
    owner: string;
    repoName: string;
    cloneUrl: string;
    branch: string;
  }) => void;
}

interface CreateRepoResult {
  repoUrl: string;
  owner: string;
  repoName: string;
}

interface Installation {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/--+/g, "-")
    .trim()
    .slice(0, 50);
}

export function CreateRepoDialog({
  open,
  onOpenChange,
  session,
  hasSandbox,
  onRepoCreated,
}: CreateRepoDialogProps) {
  const [repoName, setRepoName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<CreateRepoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<string>("");
  const [loadingInstallations, setLoadingInstallations] = useState(false);

  // Fetch installations when dialog opens
  useEffect(() => {
    if (open) {
      // Generate a suggested repo name from the session title
      const suggestedName = slugify(session.title);
      setRepoName(suggestedName);
      setDescription("");
      setIsPrivate(false);
      setResult(null);
      setError(null);

      // Fetch available installations
      setLoadingInstallations(true);
      fetch("/api/github/installations")
        .then((res) => res.json())
        .then((data: Installation[]) => {
          setInstallations(Array.isArray(data) ? data : []);
          // Auto-select first installation if available
          if (Array.isArray(data) && data.length > 0 && data[0]) {
            setSelectedOwner(data[0].accountLogin);
          } else {
            setSelectedOwner("");
          }
        })
        .catch(() => {
          setInstallations([]);
          setSelectedOwner("");
        })
        .finally(() => setLoadingInstallations(false));
    }
  }, [open, session.title]);

  const handleCreate = async () => {
    if (!repoName.trim()) {
      setError("Repository name is required");
      return;
    }

    if (!hasSandbox) {
      setError("Sandbox not active. Please wait for sandbox to start.");
      return;
    }

    if (!selectedOwner) {
      setError(
        "Select an account to create the repository under. Install the GitHub App on an account first.",
      );
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/github/create-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          repoName: repoName.trim(),
          description: description.trim() || undefined,
          isPrivate,
          sessionTitle: session.title,
          owner: selectedOwner,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create repository");
      }

      const createResult = {
        repoUrl: data.repoUrl as string,
        owner: data.owner as string,
        repoName: data.repoName as string,
        cloneUrl: data.cloneUrl as string,
        branch: data.branch as string,
      };
      setResult(createResult);
      onRepoCreated?.(createResult);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create repository",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5" />
            Create Repository
          </DialogTitle>
          <DialogDescription>
            Create a new GitHub repository from your work in this sandbox.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          // Success state
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <Check className="h-6 w-6 text-green-500" />
            </div>
            <div className="text-center">
              <p className="font-medium">Repository created successfully!</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.owner}/{result.repoName}
              </p>
              {/* External link to GitHub - not internal navigation */}
              {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
              <a
                href={result.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
              >
                View on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </div>
        ) : (
          // Form
          <>
            <div className="grid gap-4 py-4">
              {/* Owner / Account Picker */}
              <div className="grid gap-2">
                <Label htmlFor="repo-owner">Owner</Label>
                {loadingInstallations ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading accounts...
                  </div>
                ) : installations.length > 0 ? (
                  <Select
                    value={selectedOwner}
                    onValueChange={setSelectedOwner}
                    disabled={isCreating}
                  >
                    <SelectTrigger id="repo-owner" className="w-full">
                      <SelectValue placeholder="Select an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {installations.map((inst) => (
                        <SelectItem
                          key={inst.installationId}
                          value={inst.accountLogin}
                        >
                          {inst.accountLogin}
                          {inst.accountType === "Organization" ? " (org)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No GitHub App installations found. Install the GitHub App on
                    an account first.
                  </p>
                )}
              </div>

              {/* Repository Name */}
              <div className="grid gap-2">
                <Label htmlFor="repo-name">Repository name</Label>
                {selectedOwner && (
                  <p className="text-xs text-muted-foreground">
                    {selectedOwner}/{repoName || "..."}
                  </p>
                )}
                <Input
                  id="repo-name"
                  placeholder="my-awesome-project"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  disabled={isCreating}
                />
                <p className="text-xs text-muted-foreground">
                  Use letters, numbers, hyphens, underscores, and periods only.
                </p>
              </div>

              {/* Description */}
              <div className="grid gap-2">
                <Label htmlFor="repo-description">Description (optional)</Label>
                <Textarea
                  id="repo-description"
                  placeholder="A short description of your project"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isCreating}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Private Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="repo-private">Private repository</Label>
                  <p className="text-xs text-muted-foreground">
                    Only you can see this repository
                  </p>
                </div>
                <Switch
                  id="repo-private"
                  checked={isPrivate}
                  onCheckedChange={setIsPrivate}
                  disabled={isCreating}
                />
              </div>

              {/* Error Alert */}
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  isCreating ||
                  !repoName.trim() ||
                  !hasSandbox ||
                  !selectedOwner
                }
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Repository"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

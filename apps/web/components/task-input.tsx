"use client";

import { useState, useRef, useEffect } from "react";
import type { FileUIPart } from "ai";
import { Plus, Mic, ArrowUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCEPT_IMAGE_TYPES, isValidImageType } from "@/lib/image-utils";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { useAudioRecording } from "@/hooks/use-audio-recording";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { RepoSelectorCompact } from "./repo-selector-compact";
import { BranchSelectorCompact } from "./branch-selector-compact";
import { ModelSelectorCompact } from "./model-selector-compact";
import {
  SandboxSelectorCompact,
  DEFAULT_SANDBOX_TYPE,
  type SandboxType,
} from "./sandbox-selector-compact";
import { ImageAttachmentsPreview } from "./image-attachments-preview";
import { DEFAULT_MODEL_ID } from "@/lib/models";

interface TaskInputProps {
  onSubmit: (task: {
    prompt: string;
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    files?: FileUIPart[];
    modelId: string;
    sandboxType: SandboxType;
  }) => void;
  isLoading?: boolean;
}

export function TaskInput({ onSubmit, isLoading }: TaskInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [isNewBranch, setIsNewBranch] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [selectedSandbox, setSelectedSandbox] =
    useState<SandboxType>(DEFAULT_SANDBOX_TYPE);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { preferences } = useUserPreferences();

  // Update model and sandbox when preferences load
  useEffect(() => {
    if (preferences?.defaultModelId) {
      setSelectedModel(preferences.defaultModelId);
    }
    if (preferences?.defaultSandboxType) {
      setSelectedSandbox(preferences.defaultSandboxType);
    }
  }, [preferences]);

  const {
    images,
    addImage,
    addImages,
    removeImage,
    clearImages,
    getFileParts,
    fileInputRef,
    openFilePicker,
  } = useImageAttachments();

  const {
    state: recordingState,
    error: recordingError,
    clearError: clearRecordingError,
    toggleRecording,
  } = useAudioRecording();

  const handleMicClick = async () => {
    clearRecordingError();
    const transcribedText = await toggleRecording();
    if (transcribedText) {
      setPrompt((prev) =>
        prev ? `${prev} ${transcribedText}` : transcribedText,
      );
      inputRef.current?.focus();
    }
  };

  // Handle click outside to collapse
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        if (!prompt.trim()) {
          setIsFocused(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [prompt]);

  // Auto-resize textarea up to 7 lines
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    // Get actual line height from computed styles
    const computedStyle = getComputedStyle(textarea);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 24;
    const maxLines = 7;
    const maxHeight = lineHeight * maxLines;

    // Store current height to avoid flicker
    const currentHeight = textarea.offsetHeight;

    // Temporarily set height to 0 to measure scrollHeight accurately
    // Using 0 instead of 'auto' prevents visible collapse
    textarea.style.height = "0";
    const scrollHeight = textarea.scrollHeight;

    // Set new height, capped at max
    const newHeight = Math.min(scrollHeight, maxHeight);

    // Only update if height actually changed to minimize reflows
    if (Math.abs(newHeight - currentHeight) > 1) {
      textarea.style.height = `${newHeight}px`;
    } else {
      textarea.style.height = `${currentHeight}px`;
    }
  }, [prompt]);

  const handleSubmit = () => {
    const hasContent = prompt.trim() || images.length > 0;
    if (!hasContent || isLoading) return;

    onSubmit({
      prompt: prompt.trim(),
      repoOwner: selectedOwner || undefined,
      repoName: selectedRepo || undefined,
      branch: selectedBranch || undefined,
      cloneUrl:
        selectedOwner && selectedRepo
          ? `https://github.com/${selectedOwner}/${selectedRepo}`
          : undefined,
      isNewBranch,
      files: getFileParts(),
      modelId: selectedModel,
      sandboxType: selectedSandbox,
    });
    setPrompt("");
    clearImages();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
    setSelectedBranch(null); // Reset branch when repo changes
    setIsNewBranch(false);
  };

  const handleBranchChange = (branch: string | null, newBranch: boolean) => {
    setSelectedBranch(branch);
    setIsNewBranch(newBranch);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (isValidImageType(item.type)) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          addImage(file).catch(() => {
            // Silently ignore paste errors - rare edge case
          });
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only set isDragging to false if we're leaving the container entirely
    // (not just moving to a child element)
    if (
      containerRef.current &&
      !containerRef.current.contains(e.relatedTarget as Node)
    ) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      addImages(files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      addImages(files);
    }
    // Reset input so the same file can be selected again
    e.target.value = "";
  };

  const hasContent = prompt.trim() || images.length > 0;

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-neutral-800/60 transition-all duration-200",
        isFocused && "border-white/15 bg-neutral-800/80",
        isDragging && "border-blue-500/50 bg-blue-500/5",
      )}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_IMAGE_TYPES}
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Image attachments preview */}
      <ImageAttachmentsPreview images={images} onRemove={removeImage} />

      {/* Input area */}
      <div className={cn("px-5 pb-3", images.length > 0 ? "pt-0" : "pt-4")}>
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask a question with /plan"
          rows={1}
          className="w-full resize-none overflow-y-auto bg-transparent text-base text-foreground placeholder:text-neutral-500 focus:outline-none"
          style={{
            minHeight: "24px",
          }}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-3 pb-3 pt-0">
        <div className="flex items-center">
          <button
            type="button"
            onClick={openFilePicker}
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
          >
            <Plus className="h-4 w-4" />
          </button>

          <ModelSelectorCompact
            value={selectedModel}
            onChange={setSelectedModel}
          />

          <SandboxSelectorCompact
            value={selectedSandbox}
            onChange={setSelectedSandbox}
          />

          <RepoSelectorCompact
            selectedOwner={selectedOwner}
            selectedRepo={selectedRepo}
            onSelect={handleRepoSelect}
          />

          {selectedOwner && selectedRepo && (
            <BranchSelectorCompact
              owner={selectedOwner}
              repo={selectedRepo}
              value={selectedBranch}
              isNewBranch={isNewBranch}
              onChange={handleBranchChange}
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleMicClick}
            disabled={recordingState === "processing"}
            className={cn(
              "relative flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              recordingState === "recording"
                ? "text-red-500"
                : "text-neutral-500 hover:bg-white/5 hover:text-neutral-300",
              recordingState === "processing" &&
                "cursor-not-allowed opacity-50",
            )}
          >
            {recordingState === "recording" && (
              <span className="absolute inset-0 animate-pulse rounded-full bg-red-500/30" />
            )}
            {recordingState === "processing" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasContent || isLoading}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              hasContent && !isLoading
                ? "bg-neutral-200 text-neutral-900 hover:bg-neutral-300"
                : "bg-neutral-700 text-neutral-500",
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Recording error message */}
      {recordingError && (
        <div className="px-5 pb-3">
          <p className="text-sm text-red-400">{recordingError}</p>
        </div>
      )}
    </div>
  );
}

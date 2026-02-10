import {
  countLines,
  createPasteToken,
  expandPasteTokens,
  extractPasteTokens,
  formatPastePlaceholder,
  isPasteTokenChar,
  type PasteBlock,
} from "@open-harness/shared";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { FileUIPart } from "ai";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChatContext } from "../chat-context";
import { PRIMARY_COLOR } from "../lib/colors";
import { extractMention, getFileSuggestions } from "../lib/file-suggestions";
import {
  formatImagePlaceholder,
  type ImageBlock,
  imageBlockToFilePart,
} from "../lib/image-blocks";
import {
  getClipboardImage,
  imageToDataUrl,
  isImagePath,
  loadImageFromPath,
} from "../lib/image-clipboard";
import { inputFromKey } from "../lib/keyboard";
import {
  extractSlashCommand,
  getCommandAction,
  getCommandSuggestions,
  type SlashCommandAction,
} from "../lib/slash-commands";
import type { AutoAcceptMode } from "../types";
import { type Suggestion, Suggestions } from "./suggestions";
import { TextInput } from "./text-input";

type InputBoxProps = {
  onSubmit: (value: string, files?: FileUIPart[]) => void;
  autoAcceptMode: AutoAcceptMode;
  onToggleAutoAccept: () => void;
  onCommandSelect?: (action: SlashCommandAction) => void;
  disabled?: boolean;
  inputTokens?: number;
  contextLimit?: number;
  pasteCollapseLineThreshold?: number;
};

function getAutoAcceptLabel(mode: AutoAcceptMode): string {
  switch (mode) {
    case "off":
      return "auto-accept off";
    case "edits":
      return "auto-accept edits on";
    case "all":
      return "auto-accept all on";
  }
}

function getAutoAcceptColor(mode: AutoAcceptMode): string {
  switch (mode) {
    case "off":
      return "gray";
    case "edits":
      return "green";
    case "all":
      return PRIMARY_COLOR;
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}

// Memoized context usage indicator
const ContextUsageIndicator = memo(function ContextUsageIndicator({
  inputTokens,
  contextLimit,
}: {
  inputTokens: number;
  contextLimit: number;
}) {
  if (inputTokens === 0) return null;

  const percentage =
    contextLimit > 0 ? Math.round((inputTokens / contextLimit) * 100) : 0;

  return (
    <text fg="gray">
      {formatTokens(inputTokens)}/{formatTokens(contextLimit)} ({percentage}%)
    </text>
  );
});

// Memoized auto-accept indicator
const AutoAcceptIndicator = memo(function AutoAcceptIndicator({
  mode,
}: {
  mode: AutoAcceptMode;
}) {
  return (
    <box marginTop={0} flexDirection="row">
      <text fg={getAutoAcceptColor(mode)}>▸▸ {getAutoAcceptLabel(mode)}</text>
      <text fg="gray"> (shift+tab to cycle)</text>
    </box>
  );
});

export const InputBox = memo(function InputBox({
  onSubmit,
  autoAcceptMode,
  onToggleAutoAccept,
  onCommandSelect,
  disabled = false,
  inputTokens = 0,
  contextLimit = 0,
  pasteCollapseLineThreshold = 5,
}: InputBoxProps) {
  const { state } = useChatContext();
  const skills = state.skills;
  const [value, setValue] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionInfo, setMentionInfo] = useState<{
    mentionStart: number;
    partialPath: string;
  } | null>(null);
  const [commandInfo, setCommandInfo] = useState<{
    commandStart: number;
    partialCommand: string;
  } | null>(null);
  const [pasteBlocks, setPasteBlocks] = useState<PasteBlock[]>([]);
  const [imageBlocks, setImageBlocks] = useState<ImageBlock[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null,
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextPasteIdRef = useRef(1);
  const nextImageIdRef = useRef(1);

  const handleImagePaste = useCallback(async () => {
    const clipboardImage = await getClipboardImage();
    if (clipboardImage) {
      const id = nextImageIdRef.current;
      nextImageIdRef.current += 1;
      const dataUrl = imageToDataUrl(clipboardImage);
      setImageBlocks((prev) => [
        ...prev,
        { id, dataUrl, mediaType: clipboardImage.mediaType },
      ]);
      setSelectedImageIndex(null);
    }
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setImageBlocks((prev) => prev.filter((_, i) => i !== index));
    setSelectedImageIndex(null);
  }, []);

  useKeyboard((event) => {
    const input = inputFromKey(event);
    // Shift+Tab to cycle auto-accept modes
    if (event.shift && event.name === "tab") {
      onToggleAutoAccept();
    }
    // Escape to close suggestions or deselect image
    if (event.name === "escape") {
      if (selectedImageIndex !== null) {
        setSelectedImageIndex(null);
      } else if (suggestions.length > 0) {
        setSuggestions([]);
        setMentionInfo(null);
        setCommandInfo(null);
      }
    }
    // Ctrl+V to paste image
    if (event.ctrl && input === "v" && !disabled) {
      handleImagePaste();
    }
    // Up arrow to select image when at start of input
    if (
      event.name === "up" &&
      imageBlocks.length > 0 &&
      cursorPosition === 0 &&
      suggestions.length === 0
    ) {
      if (selectedImageIndex === null) {
        setSelectedImageIndex(imageBlocks.length - 1);
      } else if (selectedImageIndex > 0) {
        setSelectedImageIndex(selectedImageIndex - 1);
      }
    }
    // Down arrow to deselect image
    if (event.name === "down" && selectedImageIndex !== null) {
      if (selectedImageIndex < imageBlocks.length - 1) {
        setSelectedImageIndex(selectedImageIndex + 1);
      } else {
        setSelectedImageIndex(null);
      }
    }
    // Backspace to remove selected image
    if (
      (event.name === "backspace" || event.name === "delete") &&
      selectedImageIndex !== null
    ) {
      handleRemoveImage(selectedImageIndex);
    }
  });

  // Update suggestions when cursor position or value changes (debounced)
  useEffect(() => {
    // Check for slash commands first (priority over @ mentions)
    const command = extractSlashCommand(value, cursorPosition);
    if (command) {
      setCommandInfo(command);
      setMentionInfo(null);
      setSuggestions(getCommandSuggestions(command.partialCommand, skills));
      setSelectedIndex(0);
      return;
    }

    // Clear command info if not in a command
    setCommandInfo(null);

    // Check for @ mentions
    const mention = extractMention(value, cursorPosition);
    setMentionInfo(mention);

    if (!mention) {
      setSuggestions([]);
      return;
    }

    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Debounce the suggestions fetch
    debounceRef.current = setTimeout(() => {
      getFileSuggestions(mention.partialPath).then((results) => {
        setSuggestions(results);
        setSelectedIndex(0);
      });
    }, 100);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value, cursorPosition, skills]);

  const pasteBlocksByToken = useMemo(() => {
    return new Map(pasteBlocks.map((block) => [block.token, block]));
  }, [pasteBlocks]);

  const updateValue = useCallback((newValue: string) => {
    setValue(newValue);
    const tokens = extractPasteTokens(newValue);
    setPasteBlocks((prev) => prev.filter((block) => tokens.has(block.token)));
  }, []);

  const handleValueChange = useCallback(
    (newValue: string) => {
      updateValue(newValue);
    },
    [updateValue],
  );

  const handleCursorChange = useCallback((position: number) => {
    setCursorPosition(position);
  }, []);

  const addImageFromPath = useCallback(async (filePath: string) => {
    const image = await loadImageFromPath(filePath);
    if (image) {
      const id = nextImageIdRef.current;
      nextImageIdRef.current += 1;
      const dataUrl = imageToDataUrl(image);
      setImageBlocks((prev) => [
        ...prev,
        { id, dataUrl, mediaType: image.mediaType },
      ]);
      return true;
    }
    return false;
  }, []);

  const handlePaste = useCallback(
    (text: string) => {
      const trimmedText = text.trim();
      if (isImagePath(trimmedText)) {
        addImageFromPath(trimmedText);
        return true;
      }

      const lineCount = countLines(text);
      if (lineCount <= 1 || lineCount < pasteCollapseLineThreshold) {
        return false;
      }

      const id = nextPasteIdRef.current;
      const token = createPasteToken(id);
      nextPasteIdRef.current += 1;

      const newValue =
        value.slice(0, cursorPosition) + token + value.slice(cursorPosition);
      updateValue(newValue);
      setCursorPosition(cursorPosition + 1);
      setPasteBlocks((prev) => [...prev, { id, token, text, lineCount }]);
      return true;
    },
    [
      cursorPosition,
      pasteCollapseLineThreshold,
      updateValue,
      value,
      addImageFromPath,
    ],
  );

  const renderPasteToken = useCallback(
    (token: string) => {
      const block = pasteBlocksByToken.get(token);
      if (!block) return "[Pasted text]";
      return formatPastePlaceholder(block.id, block.lineCount);
    },
    [pasteBlocksByToken],
  );

  const handleUpArrow = useCallback(() => {
    if (suggestions.length > 0) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1,
      );
      return true; // Consumed the event
    }
    return false;
  }, [suggestions.length]);

  const handleDownArrow = useCallback(() => {
    if (suggestions.length > 0) {
      setSelectedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0,
      );
      return true; // Consumed the event
    }
    return false;
  }, [suggestions.length]);

  const handleCtrlN = useCallback(() => {
    if (suggestions.length > 0) {
      setSelectedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0,
      );
      return true; // Consumed the event
    }
    return false;
  }, [suggestions.length]);

  const handleCtrlP = useCallback(() => {
    if (suggestions.length > 0) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1,
      );
      return true; // Consumed the event
    }
    return false;
  }, [suggestions.length]);

  const selectSuggestion = useCallback(() => {
    if (suggestions.length === 0) return false;

    const selected = suggestions[selectedIndex];
    if (!selected) return false;

    // Handle slash command selection
    if (commandInfo) {
      const action = getCommandAction(selected.value, skills);
      if (action) {
        // Handle skill selection by autocompleting (not submitting)
        if (typeof action === "object" && action.type === "invoke-skill") {
          const newValue = `/${action.skillName} `;
          updateValue(newValue);
          setCursorPosition(newValue.length);
          setSuggestions([]);
          setCommandInfo(null);
          return true;
        }

        // Handle built-in command actions (execute immediately)
        updateValue("");
        setCursorPosition(0);
        setSuggestions([]);
        setCommandInfo(null);
        if (onCommandSelect) {
          onCommandSelect(action);
        }
        return true;
      }
      return false;
    }

    // Handle @ mention selection
    if (mentionInfo) {
      // Replace the partial path with the selected suggestion + space
      const before = value.slice(0, mentionInfo.mentionStart + 1); // Include @
      const after = value.slice(cursorPosition);
      const newValue = before + selected.value + " " + after;
      updateValue(newValue);
      // Update cursor position to after the space
      const newCursorPos =
        mentionInfo.mentionStart + 1 + selected.value.length + 1;
      setCursorPosition(newCursorPos);
      // Close suggestions after selection
      setSuggestions([]);
      setMentionInfo(null);
      return true; // Consumed the event
    }

    return false;
  }, [
    suggestions,
    selectedIndex,
    commandInfo,
    mentionInfo,
    value,
    cursorPosition,
    updateValue,
    onCommandSelect,
    skills,
  ]);

  const handleTab = useCallback(() => {
    // For slash commands, tab selects like enter
    if (commandInfo) {
      return selectSuggestion();
    }

    // If a directory is selected, "enter" it instead of selecting
    if (suggestions.length > 0 && mentionInfo) {
      const selected = suggestions[selectedIndex];
      if (selected?.isDirectory) {
        // Replace the partial path with the directory path (no trailing space)
        const before = value.slice(0, mentionInfo.mentionStart + 1); // Include @
        const after = value.slice(cursorPosition);
        const newValue = before + selected.value + after;
        updateValue(newValue);
        // Update cursor position to end of directory path
        const newCursorPos =
          mentionInfo.mentionStart + 1 + selected.value.length;
        setCursorPosition(newCursorPos);
        // Keep suggestions open - they will refresh via the useEffect
        return true;
      }
    }
    // For files, select normally
    return selectSuggestion();
  }, [
    suggestions,
    selectedIndex,
    commandInfo,
    mentionInfo,
    value,
    cursorPosition,
    updateValue,
    selectSuggestion,
  ]);

  const handleReturn = useCallback(() => {
    return selectSuggestion();
  }, [selectSuggestion]);

  const handleSubmit = useCallback(
    (submitValue: string) => {
      const expandedValue = expandPasteTokens(submitValue, pasteBlocksByToken);
      const trimmedValue = expandedValue.trim();
      const hasContent = trimmedValue || imageBlocks.length > 0;
      if (hasContent && !disabled) {
        const files =
          imageBlocks.length > 0
            ? imageBlocks.map(imageBlockToFilePart)
            : undefined;
        onSubmit(trimmedValue, files);
        updateValue("");
        setCursorPosition(0);
        setSuggestions([]);
        setMentionInfo(null);
        setCommandInfo(null);
        setImageBlocks([]);
        setSelectedImageIndex(null);
        nextImageIdRef.current = 1;
      }
    },
    [disabled, onSubmit, pasteBlocksByToken, updateValue, imageBlocks],
  );

  return (
    <box flexDirection="column" marginTop={1}>
      {/* Image attachments */}
      {imageBlocks.length > 0 && (
        <box marginBottom={0} gap={1} flexDirection="row">
          {imageBlocks.map((block, index) => (
            <box key={block.id} flexDirection="row">
              <text
                fg={selectedImageIndex === index ? "cyan" : "blue"}
                attributes={
                  selectedImageIndex === index
                    ? TextAttributes.INVERSE
                    : undefined
                }
              >
                {formatImagePlaceholder(block.id)}
              </text>
              {selectedImageIndex === index && (
                <text fg="gray"> (backspace remove · ↓ cancel)</text>
              )}
            </box>
          ))}
          {selectedImageIndex === null && <text fg="gray">(↑ to select)</text>}
        </box>
      )}

      {/* Input line */}
      <box
        borderStyle="single"
        border={["top", "bottom"]}
        borderColor="#555"
        flexDirection="row"
      >
        <text fg={disabled ? "gray" : "white"}>&gt; </text>
        {disabled ? (
          <text fg="gray">Waiting...</text>
        ) : (
          <TextInput
            value={value}
            onChange={handleValueChange}
            onSubmit={handleSubmit}
            onCursorChange={handleCursorChange}
            cursorPosition={cursorPosition}
            onUpArrow={handleUpArrow}
            onDownArrow={handleDownArrow}
            onTab={handleTab}
            onCtrlN={handleCtrlN}
            onCtrlP={handleCtrlP}
            onReturn={handleReturn}
            onPaste={handlePaste}
            isTokenChar={isPasteTokenChar}
            renderToken={renderPasteToken}
            placeholder='Try "write a test for <filepath>"'
          />
        )}
      </box>

      {/* Suggestions dropdown (below input) */}
      <Suggestions
        suggestions={suggestions}
        selectedIndex={selectedIndex}
        visible={suggestions.length > 0}
      />

      {/* Bottom row: auto-accept (left) and context usage (right) */}
      <box justifyContent="space-between" flexDirection="row">
        <AutoAcceptIndicator mode={autoAcceptMode} />
        {!disabled && (
          <ContextUsageIndicator
            inputTokens={inputTokens}
            contextLimit={contextLimit}
          />
        )}
      </box>
    </box>
  );
});

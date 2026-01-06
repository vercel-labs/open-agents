import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  memo,
  useMemo,
} from "react";
import { Box, Text, useInput } from "ink";
import type { FileUIPart } from "ai";
import { TextInput } from "./text-input.js";
import { Suggestions, type Suggestion } from "./suggestions.js";
import { getFileSuggestions, extractMention } from "../lib/file-suggestions.js";
import {
  countLines,
  createPasteToken,
  expandPasteTokens,
  extractPasteTokens,
  formatPastePlaceholder,
  isPasteTokenChar,
  type PasteBlock,
} from "../lib/paste-blocks.js";
import {
  getClipboardImage,
  imageToDataUrl,
  isImagePath,
  loadImageFromPath,
} from "../lib/image-clipboard.js";
import {
  formatImagePlaceholder,
  imageBlockToFilePart,
  type ImageBlock,
} from "../lib/image-blocks.js";
import type { AutoAcceptMode } from "../types.js";

type InputBoxProps = {
  onSubmit: (value: string, files?: FileUIPart[]) => void;
  autoAcceptMode: AutoAcceptMode;
  onToggleAutoAccept: () => void;
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
      return "yellow";
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
    <Text color="gray">
      {formatTokens(inputTokens)}/{formatTokens(contextLimit)} ({percentage}%)
    </Text>
  );
});

// Memoized auto-accept indicator
const AutoAcceptIndicator = memo(function AutoAcceptIndicator({
  mode,
}: {
  mode: AutoAcceptMode;
}) {
  return (
    <Box marginTop={0}>
      <Text color={getAutoAcceptColor(mode)}>
        ▸▸ {getAutoAcceptLabel(mode)}
      </Text>
      <Text color="gray"> (shift+tab to cycle)</Text>
    </Box>
  );
});

export const InputBox = memo(function InputBox({
  onSubmit,
  autoAcceptMode,
  onToggleAutoAccept,
  disabled = false,
  inputTokens = 0,
  contextLimit = 0,
  pasteCollapseLineThreshold = 5,
}: InputBoxProps) {
  const [value, setValue] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionInfo, setMentionInfo] = useState<{
    mentionStart: number;
    partialPath: string;
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

  useInput((input, key) => {
    // Shift+Tab to cycle auto-accept modes
    if (key.shift && key.tab) {
      onToggleAutoAccept();
    }
    // Escape to close suggestions or deselect image
    if (key.escape) {
      if (selectedImageIndex !== null) {
        setSelectedImageIndex(null);
      } else if (suggestions.length > 0) {
        setSuggestions([]);
        setMentionInfo(null);
      }
    }
    // Ctrl+V to paste image
    if (key.ctrl && input === "v" && !disabled) {
      handleImagePaste();
    }
    // Up arrow to select image when at start of input
    if (
      key.upArrow &&
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
    if (key.downArrow && selectedImageIndex !== null) {
      if (selectedImageIndex < imageBlocks.length - 1) {
        setSelectedImageIndex(selectedImageIndex + 1);
      } else {
        setSelectedImageIndex(null);
      }
    }
    // Backspace to remove selected image
    if ((key.backspace || key.delete) && selectedImageIndex !== null) {
      handleRemoveImage(selectedImageIndex);
    }
  });

  // Update suggestions when cursor position or value changes (debounced)
  useEffect(() => {
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
  }, [value, cursorPosition]);

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
    if (suggestions.length > 0 && mentionInfo) {
      const selected = suggestions[selectedIndex];
      if (selected) {
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
    }
    return false;
  }, [
    suggestions,
    selectedIndex,
    mentionInfo,
    value,
    cursorPosition,
    updateValue,
  ]);

  const handleTab = useCallback(() => {
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
        setImageBlocks([]);
        setSelectedImageIndex(null);
        nextImageIdRef.current = 1;
      }
    },
    [disabled, onSubmit, pasteBlocksByToken, updateValue, imageBlocks],
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Image attachments */}
      {imageBlocks.length > 0 && (
        <Box marginBottom={0} gap={1}>
          {imageBlocks.map((block, index) => (
            <Box key={block.id}>
              <Text
                color={selectedImageIndex === index ? "cyan" : "blue"}
                inverse={selectedImageIndex === index}
              >
                {formatImagePlaceholder(block.id)}
              </Text>
              {selectedImageIndex === index && (
                <Text color="gray"> (backspace remove · ↓ cancel)</Text>
              )}
            </Box>
          ))}
          {selectedImageIndex === null && (
            <Text color="gray">(↑ to select)</Text>
          )}
        </Box>
      )}

      {/* Input line */}
      <Box
        borderStyle="single"
        borderTop
        borderBottom
        borderLeft={false}
        borderRight={false}
        borderColor="#555"
      >
        <Text color={disabled ? "gray" : "white"}>&gt; </Text>
        {disabled ? (
          <Text color="gray">Waiting...</Text>
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
      </Box>

      {/* Suggestions dropdown (below input) */}
      <Suggestions
        suggestions={suggestions}
        selectedIndex={selectedIndex}
        visible={suggestions.length > 0}
      />

      {/* Bottom row: auto-accept (left) and context usage (right) */}
      <Box justifyContent="space-between">
        <AutoAcceptIndicator mode={autoAcceptMode} />
        <ContextUsageIndicator
          inputTokens={inputTokens}
          contextLimit={contextLimit}
        />
      </Box>
    </Box>
  );
});

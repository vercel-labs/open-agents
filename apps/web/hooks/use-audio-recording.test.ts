import { describe, expect, test } from "bun:test";
import {
  getSpeechRecognitionConstructor,
  getSpeechRecognitionErrorMessage,
  joinTranscriptParts,
} from "./use-audio-recording";

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "en-US";
  maxAlternatives = 1;
  onresult = null;
  onerror = null;
  onend = null;

  start() {}
  stop() {}
  abort() {}
}

function MockWebkitSpeechRecognition() {}

describe("getSpeechRecognitionConstructor", () => {
  test("prefers the standard SpeechRecognition constructor", () => {
    const constructor = getSpeechRecognitionConstructor({
      SpeechRecognition: MockSpeechRecognition,
      webkitSpeechRecognition: MockWebkitSpeechRecognition,
    } as unknown as Window);

    expect(constructor).toBe(
      MockSpeechRecognition as unknown as typeof constructor,
    );
  });

  test("falls back to webkitSpeechRecognition when needed", () => {
    const constructor = getSpeechRecognitionConstructor({
      webkitSpeechRecognition: MockWebkitSpeechRecognition,
    } as unknown as Window);

    expect(constructor).toBe(
      MockWebkitSpeechRecognition as unknown as typeof constructor,
    );
  });

  test("returns null when Web Speech is unavailable", () => {
    expect(getSpeechRecognitionConstructor(undefined)).toBeNull();
  });
});

describe("joinTranscriptParts", () => {
  test("joins and trims transcript segments", () => {
    expect(joinTranscriptParts(["  hello  ", "", "world  "])).toBe(
      "hello world",
    );
  });

  test("returns null for empty transcript content", () => {
    expect(joinTranscriptParts(["  ", ""])).toBeNull();
  });
});

describe("getSpeechRecognitionErrorMessage", () => {
  test("maps permission errors to a friendly message", () => {
    expect(getSpeechRecognitionErrorMessage("not-allowed")).toBe(
      "Microphone access denied. Please allow microphone access to use voice input.",
    );
  });

  test("ignores aborted recognition events", () => {
    expect(getSpeechRecognitionErrorMessage("aborted")).toBeNull();
  });
});

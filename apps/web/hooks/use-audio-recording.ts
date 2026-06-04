"use client";

import { useState, useCallback, useRef, useEffect } from "react";

type RecordingState = "idle" | "recording" | "processing";
type RecordingMethod = "web-speech" | "external-service";

type SpeechRecognitionConstructor = new () => WebSpeechRecognition;

interface TranscribeResponse {
  text?: string;
  error?: string;
  details?: string;
}

interface UseAudioRecordingOptions {
  onTranscription?: (text: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

type SpeechRecognitionResultListLike = ArrayLike<SpeechRecognitionResultLike>;

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface WebSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  addEventListener(
    type: "result",
    listener: (event: SpeechRecognitionEventLike) => void,
  ): void;
  addEventListener(
    type: "error",
    listener: (event: SpeechRecognitionErrorEventLike) => void,
  ): void;
  addEventListener(type: "end", listener: () => void): void;
  removeEventListener(
    type: "result",
    listener: (event: SpeechRecognitionEventLike) => void,
  ): void;
  removeEventListener(
    type: "error",
    listener: (event: SpeechRecognitionErrorEventLike) => void,
  ): void;
  removeEventListener(type: "end", listener: () => void): void;
  start(): void;
  stop(): void;
  abort(): void;
}

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("loadend", () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (base64) {
        resolve(base64);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  const mimeTypes = ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"];
  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return "";
}

export function getSpeechRecognitionConstructor(
  windowObject: Window | undefined,
): SpeechRecognitionConstructor | null {
  if (!windowObject) {
    return null;
  }

  const speechWindow = windowObject as WindowWithSpeechRecognition;
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

export function joinTranscriptParts(parts: string[]): string | null {
  const transcript = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ")
    .trim();

  return transcript.length > 0 ? transcript : null;
}

export function getSpeechRecognitionErrorMessage(error: string): string | null {
  switch (error) {
    case "aborted":
      return null;
    case "audio-capture":
      return "Microphone not available. Please check your microphone and try again.";
    case "network":
      return "Speech recognition failed due to a network error. Please try again.";
    case "no-speech":
      return "No speech detected. Please try again.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access denied. Please allow microphone access to use voice input.";
    default:
      return "Speech recognition failed. Please try again.";
  }
}

export function useAudioRecording(options: UseAudioRecordingOptions = {}) {
  const { onTranscription } = options;

  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);

  const recordingMethodRef = useRef<RecordingMethod | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>("");
  const speechRecognitionRef = useRef<WebSpeechRecognition | null>(null);
  const speechFinalPartsRef = useRef<string[]>([]);
  const speechInterimPartRef = useRef<string>("");
  const speechStopResolverRef = useRef<(() => void) | null>(null);
  const speechStopTimeoutRef = useRef<number | null>(null);
  const speechResultListenerRef = useRef<
    ((event: SpeechRecognitionEventLike) => void) | null
  >(null);
  const speechErrorListenerRef = useRef<
    ((event: SpeechRecognitionErrorEventLike) => void) | null
  >(null);
  const speechEndListenerRef = useRef<(() => void) | null>(null);

  const emitTranscription = useCallback(
    (text: string | null) => {
      const normalizedText = joinTranscriptParts(text ? [text] : []);
      if (normalizedText) {
        onTranscription?.(normalizedText);
      }
    },
    [onTranscription],
  );

  const stopMediaStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearSpeechStopTimeout = useCallback(() => {
    if (speechStopTimeoutRef.current !== null) {
      window.clearTimeout(speechStopTimeoutRef.current);
      speechStopTimeoutRef.current = null;
    }
  }, []);

  const finishSpeechRecognition = useCallback(() => {
    if (
      !speechRecognitionRef.current &&
      recordingMethodRef.current !== "web-speech"
    ) {
      return;
    }

    clearSpeechStopTimeout();

    const transcript = joinTranscriptParts([
      ...speechFinalPartsRef.current,
      speechInterimPartRef.current,
    ]);

    speechRecognitionRef.current = null;
    recordingMethodRef.current = null;
    speechFinalPartsRef.current = [];
    speechInterimPartRef.current = "";
    speechResultListenerRef.current = null;
    speechErrorListenerRef.current = null;
    speechEndListenerRef.current = null;
    setState("idle");

    emitTranscription(transcript);

    const resolveStop = speechStopResolverRef.current;
    speechStopResolverRef.current = null;
    resolveStop?.();
  }, [clearSpeechStopTimeout, emitTranscription]);

  const transcribeWithExternalService = useCallback(
    async (audioBlob: Blob, mimeType: string): Promise<string | null> => {
      const base64Audio = await blobToBase64(audioBlob);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: base64Audio,
          mimeType,
        }),
      });

      const data = (await response.json()) as TranscribeResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Transcription failed");
      }

      return joinTranscriptParts(data.text ? [data.text] : []);
    },
    [],
  );

  const startSpeechRecognition = useCallback((): boolean => {
    const SpeechRecognition = getSpeechRecognitionConstructor(
      typeof window === "undefined" ? undefined : window,
    );

    if (!SpeechRecognition) {
      return false;
    }

    const speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = "en-US";
    speechRecognition.maxAlternatives = 1;

    speechFinalPartsRef.current = [];
    speechInterimPartRef.current = "";

    const handleSpeechRecognitionResult = (
      event: SpeechRecognitionEventLike,
    ) => {
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const transcript = result[0]?.transcript;
        if (!transcript) {
          continue;
        }

        if (result.isFinal) {
          speechFinalPartsRef.current.push(transcript);
          speechInterimPartRef.current = "";
        } else {
          speechInterimPartRef.current = transcript;
        }
      }
    };

    const handleSpeechRecognitionError = (
      event: SpeechRecognitionErrorEventLike,
    ) => {
      const message = getSpeechRecognitionErrorMessage(event.error);
      if (message) {
        setError(message);
      }
    };

    const handleSpeechRecognitionEnd = () => {
      finishSpeechRecognition();
    };

    speechResultListenerRef.current = handleSpeechRecognitionResult;
    speechErrorListenerRef.current = handleSpeechRecognitionError;
    speechEndListenerRef.current = handleSpeechRecognitionEnd;
    speechRecognitionRef.current = speechRecognition;

    speechRecognition.addEventListener("result", handleSpeechRecognitionResult);
    speechRecognition.addEventListener("error", handleSpeechRecognitionError);
    speechRecognition.addEventListener("end", handleSpeechRecognitionEnd);

    try {
      speechRecognition.start();
      recordingMethodRef.current = "web-speech";
      setState("recording");
      return true;
    } catch {
      speechRecognitionRef.current = null;
      speechFinalPartsRef.current = [];
      speechInterimPartRef.current = "";
      speechResultListenerRef.current = null;
      speechErrorListenerRef.current = null;
      speechEndListenerRef.current = null;
      return false;
    }
  }, [finishSpeechRecognition]);

  const startExternalRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      recordingMethodRef.current = "external-service";
      setState("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("Permission denied") ||
        message.includes("NotAllowedError")
      ) {
        setError(
          "Microphone access denied. Please allow microphone access to use voice input.",
        );
      } else {
        setError(`Failed to start recording: ${message}`);
      }
      recordingMethodRef.current = null;
      setState("idle");
    }
  }, []);

  const stopSpeechRecognition = useCallback(async () => {
    if (recordingMethodRef.current !== "web-speech") {
      return;
    }

    const speechRecognition = speechRecognitionRef.current;
    if (!speechRecognition) {
      finishSpeechRecognition();
      return;
    }

    setState("processing");

    await new Promise<void>((resolve) => {
      speechStopResolverRef.current = resolve;
      speechStopTimeoutRef.current = window.setTimeout(() => {
        finishSpeechRecognition();
      }, 1500);

      try {
        speechRecognition.stop();
      } catch {
        finishSpeechRecognition();
      }
    });
  }, [finishSpeechRecognition]);

  const stopExternalRecording = useCallback(async () => {
    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder || recordingMethodRef.current !== "external-service") {
      return;
    }

    await new Promise<void>((resolve) => {
      mediaRecorder.onstop = async () => {
        stopMediaStream();
        mediaRecorderRef.current = null;
        setState("processing");

        const mimeType = mimeTypeRef.current || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType,
        });
        audioChunksRef.current = [];

        try {
          const text = await transcribeWithExternalService(audioBlob, mimeType);
          emitTranscription(text);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Transcription failed: ${message}`);
        } finally {
          recordingMethodRef.current = null;
          setState("idle");
          resolve();
        }
      };

      mediaRecorder.stop();
    });
  }, [emitTranscription, stopMediaStream, transcribeWithExternalService]);

  const startRecording = useCallback(async () => {
    setError(null);

    const startedWithWebSpeech = startSpeechRecognition();
    if (startedWithWebSpeech) {
      return;
    }

    await startExternalRecording();
  }, [startExternalRecording, startSpeechRecognition]);

  const stopRecording = useCallback(async () => {
    if (state !== "recording") {
      return;
    }

    if (recordingMethodRef.current === "web-speech") {
      await stopSpeechRecognition();
      return;
    }

    if (recordingMethodRef.current === "external-service") {
      await stopExternalRecording();
    }
  }, [state, stopExternalRecording, stopSpeechRecognition]);

  const toggleRecording = useCallback(async () => {
    if (state === "recording") {
      await stopRecording();
      return;
    }

    if (state === "idle") {
      await startRecording();
    }
  }, [startRecording, state, stopRecording]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      clearSpeechStopTimeout();
      speechStopResolverRef.current = null;

      const speechRecognition = speechRecognitionRef.current;
      if (speechRecognition) {
        const resultListener = speechResultListenerRef.current;
        const errorListener = speechErrorListenerRef.current;
        const endListener = speechEndListenerRef.current;

        if (resultListener) {
          speechRecognition.removeEventListener("result", resultListener);
        }
        if (errorListener) {
          speechRecognition.removeEventListener("error", errorListener);
        }
        if (endListener) {
          speechRecognition.removeEventListener("end", endListener);
        }

        try {
          speechRecognition.abort();
        } catch {
          // Ignore cleanup failures from browser APIs.
        }
      }

      const mediaRecorder = mediaRecorderRef.current;
      if (mediaRecorder) {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        if (mediaRecorder.state !== "inactive") {
          try {
            mediaRecorder.stop();
          } catch {
            // Ignore cleanup failures from browser APIs.
          }
        }
      }

      stopMediaStream();
    };
  }, [clearSpeechStopTimeout, stopMediaStream]);

  return {
    state,
    error,
    clearError,
    startRecording,
    stopRecording,
    toggleRecording,
    isRecording: state === "recording",
    isProcessing: state === "processing",
  };
}

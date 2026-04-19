"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { getSpeechRecognitionConstructor, type BrowserSpeechRecognition } from "./web-speech-recognition";

type RecordingState = "idle" | "recording" | "processing";

interface TranscribeResponse {
  text?: string;
  error?: string;
  details?: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("loadend", () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
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
  const mimeTypes = ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"];
  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  // Fallback - let the browser choose
  return "";
}

export function useAudioRecording() {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>("");
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechTranscriptRef = useRef("");
  const speechRecognitionHadErrorRef = useRef(false);
  const speechStopResolveRef = useRef<((value: string | null) => void) | null>(
    null,
  );

  const resetMediaRecorder = useCallback(() => {
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    mimeTypeRef.current = "";
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const setPermissionError = useCallback(() => {
    setError(
      "Microphone access denied. Please allow microphone access to use voice input.",
    );
  }, []);

  const resetBrowserTranscription = useCallback(() => {
    speechRecognitionRef.current = null;
    setState("idle");
  }, []);

  const startBrowserTranscription = useCallback(async () => {
    const speechRecognitionConstructor = getSpeechRecognitionConstructor();
    if (!speechRecognitionConstructor) {
      return false;
    }

    try {
      const recognition = new speechRecognitionConstructor();
      speechRecognitionRef.current = recognition;
      speechTranscriptRef.current = "";
      speechRecognitionHadErrorRef.current = false;

      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.lang = "en-US";

      recognition.onresult = (event) => {
        let nextTranscript = speechTranscriptRef.current;
        for (
          let currentResultIndex = event.resultIndex;
          currentResultIndex < event.results.length;
          currentResultIndex++
        ) {
          const result = event.results[currentResultIndex];
          if (!result?.isFinal) {
            continue;
          }

          const alternative = result[0];
          if (!alternative?.transcript) {
            continue;
          }

          nextTranscript = nextTranscript
            ? `${nextTranscript} ${alternative.transcript}`
            : alternative.transcript;
        }

        speechTranscriptRef.current = nextTranscript;
      };

      recognition.onerror = (event) => {
        speechRecognitionHadErrorRef.current = true;
        speechTranscriptRef.current = "";
        resetBrowserTranscription();
        speechStopResolveRef.current?.(null);
        speechStopResolveRef.current = null;

        switch (event.error) {
          case "not-allowed":
          case "service-not-allowed":
            setPermissionError();
            break;
          case "audio-capture":
            setError("No microphone was found for voice input.");
            break;
          case "no-speech":
            setError("No speech was detected. Please try again.");
            break;
          default:
            setError(
              event.message
                ? `Speech recognition failed: ${event.message}`
                : `Speech recognition failed: ${event.error}`,
            );
            break;
        }
      };

      recognition.onend = () => {
        const stopResolve = speechStopResolveRef.current;
        speechStopResolveRef.current = null;
        const didFail = speechRecognitionHadErrorRef.current;
        speechRecognitionHadErrorRef.current = false;
        resetBrowserTranscription();

        if (didFail) {
          return;
        }

        const nextTranscript = speechTranscriptRef.current.trim();
        if (nextTranscript) {
          setTranscript(nextTranscript);
        }
        stopResolve?.(nextTranscript || null);
      };

      setState("recording");
      recognition.start();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("Permission denied") ||
        message.includes("NotAllowedError")
      ) {
        setPermissionError();
      } else {
        setError(`Failed to start speech recognition: ${message}`);
      }
      speechRecognitionRef.current = null;
      setState("idle");
      return false;
    }
  }, [resetBrowserTranscription, setPermissionError]);

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
      setState("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("Permission denied") ||
        message.includes("NotAllowedError")
      ) {
        setPermissionError();
      } else {
        setError(`Failed to start recording: ${message}`);
      }
      setState("idle");
    }
  }, [setPermissionError]);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript(null);

    const startedBrowserTranscription = await startBrowserTranscription();
    if (startedBrowserTranscription) {
      return;
    }

    await startExternalRecording();
  }, [startBrowserTranscription, startExternalRecording]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const speechRecognition = speechRecognitionRef.current;
    if (speechRecognition && state === "recording") {
      setState("processing");
      return new Promise((resolve) => {
        speechStopResolveRef.current = resolve;
        speechRecognition.stop();
      });
    }

    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder || state !== "recording") {
      return null;
    }

    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        setState("processing");

        const mimeType = mimeTypeRef.current || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType,
        });

        try {
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
            setError(data.error ?? "Transcription failed");
            setState("idle");
            resetMediaRecorder();
            resolve(null);
            return;
          }

          const nextTranscript = data.text?.trim() ?? "";
          const normalizedTranscript = nextTranscript || null;
          setTranscript(normalizedTranscript);
          setState("idle");
          resetMediaRecorder();
          resolve(normalizedTranscript);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Transcription failed: ${message}`);
          setState("idle");
          resetMediaRecorder();
          resolve(null);
        }
      };

      mediaRecorder.stop();
    });
  }, [resetMediaRecorder, state]);

  const toggleRecording = useCallback(async (): Promise<string | null> => {
    if (state === "recording") {
      return stopRecording();
    } else if (state === "idle") {
      await startRecording();
      return null;
    }
    return null;
  }, [state, startRecording, stopRecording]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript(null);
  }, []);

  useEffect(() => {
    return () => {
      speechStopResolveRef.current?.(null);
      speechStopResolveRef.current = null;
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
      resetMediaRecorder();
    };
  }, [resetMediaRecorder]);

  return {
    state,
    error,
    transcript,
    clearError,
    clearTranscript,
    startRecording,
    stopRecording,
    toggleRecording,
    isRecording: state === "recording",
    isProcessing: state === "processing",
  };
}

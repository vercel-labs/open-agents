import { experimental_transcribe as transcribe } from "ai";
import { elevenlabs } from "@ai-sdk/elevenlabs";
import { getServerSession } from "@/lib/session/get-server-session";

interface TranscribeRequestBody {
  audio: string; // base64-encoded audio data
  mimeType?: string; // e.g., "audio/webm" - accepted but not currently used
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: TranscribeRequestBody;
  try {
    body = (await req.json()) as TranscribeRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { audio } = body;

  if (!audio) {
    return Response.json(
      { error: "Missing required field: audio" },
      { status: 400 },
    );
  }

  // Limit audio size to ~7.5MB of raw audio (10MB base64)
  const maxBase64Length = 10 * 1024 * 1024;
  if (audio.length > maxBase64Length) {
    return Response.json(
      { error: "Audio file too large. Maximum size is approximately 7.5MB." },
      { status: 413 },
    );
  }

  try {
    const result = await transcribe({
      model: elevenlabs.transcription("scribe_v1"),
      audio: audio, // base64 string is accepted directly
      providerOptions: {
        elevenlabs: {
          // Disable audio event tagging (e.g., [background noise], [music])
          // so the transcription focuses only on spoken words
          tagAudioEvents: false,
          // Hint that we expect a single primary speaker
          numSpeakers: 1,
          // Set English as the expected language for better accuracy
          // with developer/technical terminology
          languageCode: "eng",
        },
      },
    });

    return Response.json({ text: result.text });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Transcription failed:", message);
    return Response.json(
      { error: "Transcription failed", details: message },
      { status: 500 },
    );
  }
}

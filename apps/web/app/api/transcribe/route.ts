import { experimental_transcribe as transcribe } from "ai";
import { elevenlabs } from "@ai-sdk/elevenlabs";
import { getServerSession } from "@/lib/session/get-server-session";

interface TranscribeRequestBody {
  audio: string; // base64-encoded audio data
  mimeType: string; // e.g., "audio/webm"
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

  const { audio, mimeType } = body;

  if (!audio || !mimeType) {
    return Response.json(
      { error: "Missing required fields: audio, mimeType" },
      { status: 400 },
    );
  }

  try {
    const result = await transcribe({
      model: elevenlabs.transcription("scribe_v1"),
      audio: audio, // base64 string is accepted directly
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

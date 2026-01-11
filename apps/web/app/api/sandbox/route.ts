import { connectVercelSandbox } from "@open-harness/sandbox";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

export async function POST() {
  const sandbox = await connectVercelSandbox({
    timeout: DEFAULT_TIMEOUT,
  });

  return Response.json({
    sandboxId: sandbox.id,
    createdAt: Date.now(),
    timeout: DEFAULT_TIMEOUT,
  });
}

export async function DELETE(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("sandboxId" in body) ||
    typeof (body as Record<string, unknown>).sandboxId !== "string"
  ) {
    return Response.json({ error: "Missing sandboxId" }, { status: 400 });
  }

  const { sandboxId } = body as { sandboxId: string };

  const sandbox = await connectVercelSandbox({ sandboxId });
  await sandbox.stop();

  return Response.json({ success: true });
}

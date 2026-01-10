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
  const { sandboxId }: { sandboxId: string } = await req.json();

  const sandbox = await connectVercelSandbox({ sandboxId });
  await sandbox.stop();

  return Response.json({ success: true });
}

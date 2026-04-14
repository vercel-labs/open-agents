"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import { SessionStarter } from "@/components/session-starter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CreateSessionInput = {
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch: boolean;
  sandboxType: SandboxType;
  autoCommitPush: boolean;
  autoCreatePr: boolean;
};

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastRepo: { owner: string; repo: string } | null;
  createSession: (input: CreateSessionInput) => Promise<{
    session: { id: string };
    chat: { id: string };
  }>;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  lastRepo,
  createSession,
}: NewSessionDialogProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateSession = async (input: CreateSessionInput) => {
    setIsCreating(true);
    try {
      const { session: createdSession, chat } = await createSession(input);
      onOpenChange(false);
      router.push(`/sessions/${createdSession.id}/chats/${chat.id}`);
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-none gap-0 overflow-hidden border-none bg-transparent p-0 shadow-none [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 rounded-2xl sm:rounded-[28px] border border-border/60 bg-card shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <SessionStarter
            onSubmit={handleCreateSession}
            isLoading={isCreating}
            lastRepo={lastRepo}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

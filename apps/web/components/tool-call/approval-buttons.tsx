"use client";

import { Button } from "@/components/ui/button";

export type ApprovalButtonsProps = {
  approvalId: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
};

export function ApprovalButtons({
  approvalId,
  onApprove,
  onDeny,
}: ApprovalButtonsProps) {
  return (
    <div className="mt-3 flex items-center gap-2 pl-5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-green-600 text-green-600 hover:bg-green-600 hover:text-white"
        onClick={() => onApprove?.(approvalId)}
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
        onClick={() => onDeny?.(approvalId)}
      >
        Deny
      </Button>
    </div>
  );
}

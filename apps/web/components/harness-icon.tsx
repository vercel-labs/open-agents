import { Bot } from "lucide-react";
import type { SVGProps } from "react";
import { ProviderIcon } from "@/components/provider-icons";
import {
  type ChatHarnessId,
  getChatHarnessDefinition,
} from "@/lib/chat-harnesses";

interface HarnessIconProps extends SVGProps<SVGSVGElement> {
  harnessId: ChatHarnessId;
}

export function HarnessIcon({ harnessId, ...props }: HarnessIconProps) {
  const { provider } = getChatHarnessDefinition(harnessId);
  if (!provider) {
    return <Bot {...props} />;
  }
  return <ProviderIcon provider={provider} {...props} />;
}

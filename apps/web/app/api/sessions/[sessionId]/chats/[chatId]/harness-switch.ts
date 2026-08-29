import {
  type ChatHarnessId,
  getChatHarnessDefinition,
  isChatHarnessId,
  resolveHarnessRunModelId,
} from "@/lib/chat-harnesses";
import { MODEL_VARIANT_ID_PREFIX } from "@/lib/model-variants";

export type HarnessSwitch = {
  harnessId: ChatHarnessId;
  /**
   * True when the request actually changes the chat's harness — the caller
   * must then apply the update through the empty-chat gate, because a harness
   * cannot change once the chat has messages.
   */
  changesHarness: boolean;
  /**
   * Model id the chat must be switched to alongside the harness, when the
   * current selection cannot run on it.
   */
  coercedModelId?: string;
};

type HarnessSwitchResult =
  | { ok: true; harnessSwitch: HarnessSwitch }
  | { ok: false; response: Response };

/**
 * Validate a PATCH request's harness change and decide whether the chat's
 * model has to be coerced along with it.
 *
 * Codex and Claude Code only run their native provider's models. When the
 * harness changes and the chat's plain model id cannot run on it, switch the
 * chat to the harness's default model so the selection stays truthful.
 * Variant selections resolve to their base model at run time, and an explicit
 * model update in the same request wins over coercion.
 */
export function resolveHarnessSwitch(params: {
  requestedHarnessId: string;
  currentHarnessId: ChatHarnessId;
  currentModelId: string | null;
  hasExplicitModelUpdate: boolean;
}): HarnessSwitchResult {
  if (!isChatHarnessId(params.requestedHarnessId)) {
    return {
      ok: false,
      response: Response.json({ error: "Invalid harness" }, { status: 400 }),
    };
  }

  const harnessId = params.requestedHarnessId;
  const changesHarness = harnessId !== params.currentHarnessId;
  const currentModelId = params.currentModelId;

  if (
    params.hasExplicitModelUpdate ||
    currentModelId?.startsWith(MODEL_VARIANT_ID_PREFIX)
  ) {
    return { ok: true, harnessSwitch: { harnessId, changesHarness } };
  }

  if (currentModelId === null) {
    // No model selected yet: the chat falls back to the user's default model
    // at run time, which a provider-restricted harness cannot honor — pin
    // those chats to the harness's own default model.
    const { defaultModelId } = getChatHarnessDefinition(harnessId);
    return {
      ok: true,
      harnessSwitch: {
        harnessId,
        changesHarness,
        ...(defaultModelId !== undefined
          ? { coercedModelId: defaultModelId }
          : {}),
      },
    };
  }

  const harnessModelId = resolveHarnessRunModelId(harnessId, currentModelId);
  return {
    ok: true,
    harnessSwitch: {
      harnessId,
      changesHarness,
      ...(harnessModelId !== currentModelId
        ? { coercedModelId: harnessModelId }
        : {}),
    },
  };
}

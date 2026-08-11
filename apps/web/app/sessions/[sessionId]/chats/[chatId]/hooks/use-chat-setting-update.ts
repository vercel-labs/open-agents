"use client";

import { useCallback, useState } from "react";

/**
 * Shared state machine for persisting a single chat setting (harness, model):
 * skip same-value changes, expose an in-flight flag while the update runs,
 * and log failures instead of crashing the composer.
 */
export function useChatSettingUpdate<T>(
  current: T | null | undefined,
  update: (value: T) => Promise<void>,
  settingLabel: string,
) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleChange = useCallback(
    async (next: T) => {
      if (next === current) {
        return;
      }

      try {
        setIsUpdating(true);
        await update(next);
      } catch (error) {
        console.error(`Failed to update chat ${settingLabel}:`, error);
      } finally {
        setIsUpdating(false);
      }
    },
    [current, update, settingLabel],
  );

  return { handleChange, isUpdating };
}

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

const CONFIG_DIR = join(homedir(), ".config", "open-harness");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");

export const settingsSchema = z.object({
  modelId: z.string().optional(),
});

export type Settings = z.infer<typeof settingsSchema>;

export async function loadSettings(): Promise<Settings> {
  try {
    const content = await readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(content);
    const result = settingsSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    // Invalid schema - return empty settings
    return {};
  } catch {
    return {};
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

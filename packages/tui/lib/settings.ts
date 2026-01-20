import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const CONFIG_DIR = join(homedir(), ".config", "open-harness");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");

export type Settings = {
  modelId?: string;
};

export async function loadSettings(): Promise<Settings> {
  try {
    const content = await readFile(SETTINGS_FILE, "utf-8");
    return JSON.parse(content) as Settings;
  } catch {
    return {};
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

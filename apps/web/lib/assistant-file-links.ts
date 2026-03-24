const WORKSPACE_FILE_HREF_PREFIX = "#workspace-file=";

function normalizeWorkspaceFilePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").trim();
}

function decodeWorkspaceFilePath(filePath: string): string {
  try {
    return decodeURIComponent(filePath);
  } catch {
    return filePath;
  }
}

export function buildWorkspaceFileHref(filePath: string): string {
  return `${WORKSPACE_FILE_HREF_PREFIX}${normalizeWorkspaceFilePath(filePath)}`;
}

export function parseWorkspaceFileHref(
  href: string | null | undefined,
): string | null {
  if (!href?.startsWith(WORKSPACE_FILE_HREF_PREFIX)) {
    return null;
  }

  const filePath = normalizeWorkspaceFilePath(
    decodeWorkspaceFilePath(href.slice(WORKSPACE_FILE_HREF_PREFIX.length)),
  );

  return filePath.length > 0 ? filePath : null;
}

export const assistantFileLinkPrompt = [
  "When you mention a workspace file path in assistant text, render it as a markdown link using this exact format:",
  `- \`[path/to/file.ts](${buildWorkspaceFileHref("path/to/file.ts")})\``,
  "- Use the repo-relative file path as both the visible link text and the path inside the link.",
  "- Whole-file links only for now. Do not include line numbers or ranges.",
  "- Do not use this format for URLs or anything that is not a real workspace file path.",
  "- If you are not sure of the exact file path, do not invent one.",
].join("\n");

export { WORKSPACE_FILE_HREF_PREFIX };

export function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return "…";
  if (text.length <= maxWidth) return text;
  if (maxWidth === 2) return `${text.slice(0, 1)}…`;
  return `${text.slice(0, maxWidth - 1)}…`;
}

export function normalizePhrase(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

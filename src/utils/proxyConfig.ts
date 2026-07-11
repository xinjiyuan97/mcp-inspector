export function formatMcpServerEntry(entryName: string, snippet: string): string {
  try {
    const parsed = JSON.parse(snippet) as Record<string, unknown>;
    return JSON.stringify({ [entryName]: parsed }, null, 2);
  } catch {
    return `"${entryName}": ${snippet}`;
  }
}

export function proxyEntryName(port: number): string {
  return `proxy-${port}`;
}

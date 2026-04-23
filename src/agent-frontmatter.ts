export function extractAgentName(agentContent: string): string {
  // Try YAML frontmatter first
  const frontmatterMatch = agentContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const nameMatch = frontmatterMatch[1]?.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      return (nameMatch[1] ?? "").trim().replace(/["']/g, "");
    }
  }

  // Fallback: extract from first heading
  const headingMatch = agentContent.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return (headingMatch[1] ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  return "derived-agent";
}

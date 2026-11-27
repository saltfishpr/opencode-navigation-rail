import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise";

const previewLength = 360;

export interface Turn {
  id: string;
  created: number;
  prompt: string;
  reply?: string;
}

interface PreviewLabels {
  attachment: string;
  emptyPrompt: string;
}

function excerpt(text: string, tail = false): string {
  const line = text.replace(/\s+/gu, " ").trim();
  if (line.length <= previewLength) return line;
  return tail ? "…" + line.slice(-previewLength).trimStart() : line.slice(0, previewLength).trimEnd() + "…";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function promptTurn(message: SessionMessageUser, labels: PreviewLabels): Turn {
  const metadata = record(message.metadata);
  const attachmentNames = [
    ...(Array.isArray(metadata?.attachments) ? metadata.attachments : []).map((file: unknown) => record(file)?.name),
    ...(message.files ?? []).filter((file) => !file.mention).map((file) => file.name || labels.attachment),
    ...(message.agents ?? []).filter((agent) => !agent.mention).map((agent) => "@" + agent.name),
    ...(message.skills ?? []).filter((skill) => !skill.mention).map((skill) => skill.name),
  ].filter((name): name is string => typeof name === "string" && !!name.trim());

  const text = typeof metadata?.displayText === "string" ? metadata.displayText : message.text;
  return {
    id: message.id,
    created: message.time.created,
    prompt: excerpt([text, ...new Set(attachmentNames)].filter(Boolean).join(" · ")) || labels.emptyPrompt,
  };
}

function keepTurn(id: string, pending: ReadonlySet<string>, revert?: string): boolean {
  return !pending.has(id) && (!revert || id < revert);
}

export function mergeTurns(
  indexed: readonly Turn[],
  messages: readonly SessionMessageInfo[],
  pending: ReadonlySet<string>,
  revert: string | undefined,
  labels: PreviewLabels,
): Turn[] {
  const turns = new Map<string, Turn>();
  for (const turn of indexed) {
    if (keepTurn(turn.id, pending, revert)) turns.set(turn.id, turn);
  }

  let current: Turn | undefined;
  for (const message of messages) {
    if (message.type === "user") {
      current = keepTurn(message.id, pending, revert) ? promptTurn(message, labels) : undefined;
      if (current) turns.set(current.id, current);
      continue;
    }
    if (!current || message.type !== "assistant" || !message.time.completed || (revert && message.id >= revert))
      continue;

    // Inspect the latest plain-text part only. Reasoning and tool output are never shown in the preview.
    const last = message.content.findLast((part) => part.type === "text" && !!part.text.trim());
    if (last?.type === "text") current.reply = excerpt(last.text, true);
  }

  return [...turns.values()].sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
}

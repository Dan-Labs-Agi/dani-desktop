// Recognize an already streamed Hermes reasoning suffix, without dropping novel text.
export function isHermesReasoningReplay(chunk: string, streamed: string): boolean {
  const reply = streamed.trim();
  const replay = chunk.trim();
  return reply !== "" && /^(?:> |-# )?💭/.test(replay) && replay.endsWith(reply)
    && /\n\n[ \t]*$/.test(replay.slice(0, -reply.length));
}

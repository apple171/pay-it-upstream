// Server-side settings for the dashboard's AI (Anthropic Claude). The key is read only here and
// never sent to the browser: it has no NEXT_PUBLIC_ prefix and is not passed to client components.

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_MAX_TOKENS = 2048;

export const anthropicKey = () => process.env.ANTHROPIC_API_KEY || undefined;

/** AI_MOCK=1 answers with canned replies and never calls the API. */
export const aiMock = () => process.env.AI_MOCK === "1";

/** The one model the assistant may use, from CLAUDE_MODEL. */
export const claudeModel = () => process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;

/** Output cap for one turn, whatever the browser asks for. */
export function maxTokens(): number {
  const n = Number(process.env.CLAUDE_MAX_TOKENS);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 16384) : DEFAULT_MAX_TOKENS;
}

/** The assistant is shown only when it can answer: a key, or mock mode. */
export const aiEnabled = () => aiMock() || Boolean(anthropicKey());

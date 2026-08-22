import { registerAs } from '@nestjs/config';

/**
 * Groq serves its OpenAI-compatible API under this prefix, not at the host root.
 * It is part of the contract with the response shape ai.service.ts parses, not a
 * per-deployment choice — hence a constant rather than its own env var.
 */
const GROQ_API_PATH = '/openai/v1';

/**
 * Accepts either a bare host (`https://api.groq.com`) or a full base including the
 * API path, and always yields the latter.
 *
 * The bare host is the natural thing to paste — it is what the old Angular
 * dev-server proxy used as its target, with the `/openai/v1` prefix living in the
 * request path instead. Configured that way, every call 404s with Groq's opaque
 * "Unknown request URL: POST /chat/completions". Filling the path in is friendlier
 * than failing, and a base that already carries a path is left alone so tests and
 * mock servers can point anywhere.
 */
export function normaliseGroqBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not a URL at all — hand it through so fetch reports it, rather than
    // silently substituting something that looks like it works.
    return trimmed;
  }
  return parsed.pathname === '/' ? `${trimmed}${GROQ_API_PATH}` : trimmed;
}

export default registerAs('ai', () => ({
  // No default. The key is a credential, and a fallback would let the app boot
  // looking healthy while every chat turn fails at the provider.
  groqApiKey: process.env.GROQ_API_KEY,
  groqBaseUrl: normaliseGroqBaseUrl(process.env.GROQ_BASE_URL ?? 'https://api.groq.com'),
  // Groq retired the llama-3.1-8b-instant model this originally used. Of what the
  // account can currently reach, gpt-oss-120b was both the fastest and the
  // strongest on the Lucy prompt; qwen3.6-27b is deliberately avoided because it
  // emits raw <think> reasoning into the reply, which would render in the chat.
  groqModel: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
  maxTokens: parseInt(process.env.AI_MAX_TOKENS ?? '1024', 10),
  // Upstream call timeout. Groq is normally fast; without a bound a hung
  // connection would hold a request open until the client gives up.
  requestTimeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? '30000', 10),
  // How many turns of history to forward. Caps prompt size (and spend) on a long
  // conversation while leaving enough context to stay coherent.
  maxHistoryMessages: parseInt(process.env.AI_MAX_HISTORY_MESSAGES ?? '20', 10),
}));

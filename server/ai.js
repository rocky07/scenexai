// Two providers behind one function: the company's own local model (Ollama) and the Anthropic API.

const LOCAL_URL = process.env.LOCAL_AI_URL || 'http://localhost:11434';
const LOCAL_MODEL = process.env.LOCAL_AI_MODEL || 'llama3.1';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

// Two local servers are supported:
// - Ollama: base URL such as http://localhost:11434, uses /api/chat.
// - A prompt-based server: the full URL ending in /api/ask, takes { prompt, model } and returns { response }.
const PROMPT_STYLE = /\/api\/ask\/?$/.test(LOCAL_URL);

export async function providerStatus() {
  const local = { id: 'local', label: 'Local AI', model: LOCAL_MODEL, available: false };
  const claude = { id: 'claude', label: 'Claude', model: CLAUDE_MODEL, available: Boolean(CLAUDE_KEY) };

  try {
    if (PROMPT_STYLE) {
      // Any answer at all means the server is up; the prompt endpoint doesn't have a health check.
      await fetch(new URL('/', LOCAL_URL), { signal: AbortSignal.timeout(1500) });
      local.available = true;
    } else {
      const res = await fetch(`${LOCAL_URL}/api/ask`, { signal: AbortSignal.timeout(1500) });
      local.available = res.ok;
    }
  } catch {
    local.available = false;
  }
  return [local, claude];
}

// messages: [{ role: 'user' | 'assistant', content }], system: string
export async function complete({ provider, system, messages }) {
  if (provider === 'claude') return callClaude(system, messages);
  if (provider === 'local') return callLocal(system, messages);
  throw new Error(`Unknown provider: ${provider}`);
}

async function callLocal(system, messages) {
  if (PROMPT_STYLE) return callPromptServer(system, messages);

  const res = await fetch(`${LOCAL_URL}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LOCAL_MODEL,
      stream: false,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new Error(`Local AI is not reachable at ${LOCAL_URL}. Is Ollama running?`);
  });
  if (!res.ok) throw new Error(`Local AI returned ${res.status}. Is Ollama running at ${LOCAL_URL}?`);
  const data = await res.json();
  return data.message.content;
}

// The prompt-based server takes one text prompt, so the system text and the conversation are flattened into it.
async function callPromptServer(system, messages) {
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  const prompt = `${system}\n\n${transcript}\n\nAssistant:`;

  const res = await fetch(LOCAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model: LOCAL_MODEL }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new Error(`Local AI is not reachable at ${LOCAL_URL}.`);
  });
  if (!res.ok) throw new Error(`Local AI returned ${res.status} from ${LOCAL_URL}.`);
  const data = await res.json();
  if (typeof data.response !== 'string') throw new Error('Local AI returned an unexpected reply.');
  return data.response;
}

async function callClaude(system, messages) {
  if (!CLAUDE_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system,
      messages,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API returned ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

// Two providers behind one function: the company's local model server and the Anthropic API.

const LOCAL_URL = process.env.LOCAL_AI_URL || 'http://127.0.0.1:13000/api/ask';
const LOCAL_MODEL = process.env.LOCAL_AI_MODEL || 'qwen2.5:3b';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

// The local server takes a POST to /api/ask with { prompt, model } and replies { response }.
// LOCAL_AI_URL may be the full /api/ask address or just the server's base address.
const ASK_URL = /\/api\/ask\/?$/.test(LOCAL_URL) ? LOCAL_URL : `${LOCAL_URL.replace(/\/$/, '')}/api/ask`;

export async function providerStatus() {
  const local = { id: 'local', label: 'Local AI', model: LOCAL_MODEL, available: false };
  const claude = { id: 'claude', label: 'Claude', model: CLAUDE_MODEL, available: Boolean(CLAUDE_KEY) };

  try {
    // The endpoint has no health check. Any HTTP reply, even an error, means the server is listening.
    await fetch(ASK_URL, { signal: AbortSignal.timeout(1500) });
    local.available = true;
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

// The local server takes one text prompt, so the system text and the conversation are flattened into it.
async function callLocal(system, messages) {
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  const prompt = `${system}\n\n${transcript}\n\nAssistant:`;

  const res = await fetch(ASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model: LOCAL_MODEL }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new Error(`Local AI is not reachable at ${ASK_URL}.`);
  });
  if (!res.ok) throw new Error(`Local AI returned ${res.status} from ${ASK_URL}.`);
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

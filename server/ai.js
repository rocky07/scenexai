// Two providers behind one function: the company's own local model (Ollama) and the Anthropic API.

const LOCAL_URL = process.env.LOCAL_AI_URL || 'http://localhost:11434';
const LOCAL_MODEL = process.env.LOCAL_AI_MODEL || 'llama3.1';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

export async function providerStatus() {
  const local = { id: 'local', label: 'Local AI', model: LOCAL_MODEL, available: false };
  const claude = { id: 'claude', label: 'Claude', model: CLAUDE_MODEL, available: Boolean(CLAUDE_KEY) };

  try {
    const res = await fetch(`${LOCAL_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    local.available = res.ok;
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
  const res = await fetch(`${LOCAL_URL}/api/chat`, {
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

// Company and user helpers: what the browser may see, and how each company's Anthropic key is stored.
import { encrypt, decrypt, encryptionReady } from './crypto.js';

// Everything the browser may see about a company. The Anthropic key itself never leaves the server.
export function publicCompany(company) {
  const hasKey = Boolean(company.anthropic_key_enc);
  return {
    id: company.id,
    name: company.name,
    products: company.products || '',
    brand_voice: company.brand_voice || '',
    target_audience: company.target_audience || '',
    created_at: company.created_at,
    updated_at: company.updated_at,
    active: company.active !== false,
    auto_post_allowed: Boolean(company.auto_post_allowed),
    has_anthropic_key: hasKey,
    anthropic_key_hint: hasKey ? company.anthropic_key_hint || '' : '',
  };
}

export function publicUserRecord(user) {
  return {
    id: user.id,
    company_id: user.company_id,
    email: user.email,
    name: user.name,
    role: user.role || 'customer',
    active: user.active !== false,
  };
}

// The company's own key, or null if it has none. Decrypted only when a request needs it.
export function companyAnthropicKey(company) {
  if (!company?.anthropic_key_enc || !encryptionReady()) return null;
  return decrypt(company.anthropic_key_enc);
}

// Stores a new key (encrypted), or clears it when the value is empty.
export function setAnthropicKey(company, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) {
    delete company.anthropic_key_enc;
    delete company.anthropic_key_hint;
    return;
  }
  if (!encryptionReady()) throw new Error('ENCRYPTION_KEY is not set on the server.');
  company.anthropic_key_enc = encrypt(key);
  company.anthropic_key_hint = key.slice(-4);
}

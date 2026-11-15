import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Simple JSON-file store for the MVP. Swap for PostgreSQL (with company_id + RLS) later.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, 'data');
const file = path.join(dataDir, 'db.json');

const empty = () => ({ companies: [], users: [], sessions: [], chats: [], messages: [] });

let state = null;

export function load() {
  if (state) return state;
  fs.mkdirSync(dataDir, { recursive: true });
  state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : empty();
  return state;
}

export function save() {
  // Write to a temp file, then rename, so a crash never leaves a half-written db.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

export function db() {
  return load();
}

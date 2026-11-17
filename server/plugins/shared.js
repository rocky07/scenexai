// Per-company plugin configuration and connected accounts, stored in the JSON database.
import crypto from 'node:crypto';
import { db, save } from '../store.js';
import { encrypt, decrypt } from '../crypto.js';

function tables() {
  const state = db();
  state.plugin_configs ||= [];
  state.plugin_connections ||= [];
  return state;
}

// Returns the company's values for a plugin. Secret fields are decrypted here, on the server only.
export function getConfig(companyId, plugin) {
  const row = tables().plugin_configs.find((c) => c.company_id === companyId && c.plugin_id === plugin.id);
  const values = {};
  for (const field of plugin.fields) {
    const raw = row?.values?.[field.key];
    values[field.key] = raw ? (field.secret ? decrypt(raw) : raw) : '';
  }
  return values;
}

// What the settings page may show: plain values, and only "is set" for secrets.
export function publicConfig(companyId, plugin) {
  const row = tables().plugin_configs.find((c) => c.company_id === companyId && c.plugin_id === plugin.id);
  return plugin.fields.map((field) => ({
    key: field.key,
    label: field.label,
    help: field.help || '',
    secret: Boolean(field.secret),
    value: field.secret ? '' : row?.values?.[field.key] || '',
    is_set: Boolean(row?.values?.[field.key]),
  }));
}

export function isConfigured(companyId, plugin) {
  const config = getConfig(companyId, plugin);
  return plugin.fields.every((field) => Boolean(config[field.key]));
}

// Blank secret input means "keep the saved value", so the page never has to resend secrets.
export function saveConfig(companyId, plugin, incoming) {
  const state = tables();
  let row = state.plugin_configs.find((c) => c.company_id === companyId && c.plugin_id === plugin.id);
  if (!row) {
    row = { company_id: companyId, plugin_id: plugin.id, values: {} };
    state.plugin_configs.push(row);
  }
  for (const field of plugin.fields) {
    if (!(field.key in incoming)) continue;
    const value = String(incoming[field.key] ?? '').trim();
    if (field.secret) {
      if (value) row.values[field.key] = encrypt(value);
    } else {
      row.values[field.key] = value;
    }
  }
  row.updated_at = new Date().toISOString();
  save();
}

export function connectionsFor(companyId, pluginId) {
  return tables().plugin_connections.filter((c) => c.company_id === companyId && c.plugin_id === pluginId);
}

export function publicConnection(c) {
  return { id: c.id, external_id: c.external_id, name: c.name, connected_at: c.connected_at };
}

// Replaces an earlier connection to the same external account (for example, the same Facebook Page).
export function addConnections(companyId, plugin, accounts) {
  const state = tables();
  for (const account of accounts) {
    state.plugin_connections = state.plugin_connections.filter(
      (c) => !(c.company_id === companyId && c.plugin_id === plugin.id && c.external_id === account.external_id),
    );
    state.plugin_connections.push({
      id: crypto.randomUUID(),
      company_id: companyId,
      plugin_id: plugin.id,
      external_id: account.external_id,
      name: account.name,
      token_enc: encrypt(account.token),
      expires_at: account.expires_at || null,
      connected_at: new Date().toISOString(),
    });
  }
  save();
}

export function removeConnection(companyId, pluginId, connectionId) {
  const state = tables();
  state.plugin_connections = state.plugin_connections.filter(
    (c) => !(c.id === connectionId && c.company_id === companyId && c.plugin_id === pluginId),
  );
  save();
}

// Finds one of the company's connections with its decrypted token.
export function connectionWithToken(companyId, pluginId, connectionId) {
  const row = connectionsFor(companyId, pluginId).find((c) => c.id === connectionId);
  if (!row) return null;
  return { ...publicConnection(row), external_id: row.external_id, token: decrypt(row.token_enc) };
}

// Used by webhooks: which company owns this external account?
export function findByExternal(pluginId, externalId) {
  return tables().plugin_connections.find((c) => c.plugin_id === pluginId && c.external_id === externalId) || null;
}

export function allConfigs(pluginId) {
  return tables().plugin_configs.filter((c) => c.plugin_id === pluginId);
}

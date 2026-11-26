// Admin screens for Scenex AI staff: create companies and users, set each company's Anthropic key,
// and switch companies, users, and auto-post on or off.
import crypto from 'node:crypto';
import { db, save } from './store.js';
import { hashPassword, requireAdmin } from './auth.js';
import { publicCompany, publicUserRecord, setAnthropicKey } from './accounts.js';

const MIN_PASSWORD = 8;
const newId = () => crypto.randomUUID();
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function findCompany(id) {
  return db().companies.find((c) => c.id === id) || null;
}

function passwordError(password) {
  return String(password || '').length < MIN_PASSWORD ? `Passwords need at least ${MIN_PASSWORD} characters.` : null;
}

function emailTaken(email) {
  return db().users.some((u) => u.email.toLowerCase() === normalizeEmail(email));
}

export function mountAdmin(app) {
  // All companies, with their users and key status (never the key itself).
  app.get('/api/admin/companies', requireAdmin, (req, res) => {
    const state = db();
    res.json({
      companies: state.companies.map((c) => ({
        ...publicCompany(c),
        users: state.users.filter((u) => u.company_id === c.id).map(publicUserRecord),
      })),
    });
  });

  // Creates a company and its first login.
  app.post('/api/admin/companies', requireAdmin, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const ownerName = String(req.body?.owner_name || '').trim();
    const email = normalizeEmail(req.body?.owner_email);
    const password = String(req.body?.owner_password || '');
    if (!name) return res.status(400).json({ error: 'Company name is required.' });
    if (!ownerName) return res.status(400).json({ error: 'The first user needs a name.' });
    if (!email.includes('@')) return res.status(400).json({ error: 'Enter a valid email for the first user.' });
    if (emailTaken(email)) return res.status(400).json({ error: 'That email already has an account.' });
    const pwError = passwordError(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const state = db();
    const company = {
      id: newId(),
      name,
      products: '',
      brand_voice: '',
      target_audience: '',
      created_at: new Date().toISOString(),
      active: true,
      auto_post_allowed: false,
    };
    state.companies.push(company);
    state.users.push({
      id: newId(),
      company_id: company.id,
      email,
      name: ownerName,
      password: hashPassword(password),
      role: 'customer',
      active: true,
    });
    save();
    res.status(201).json({ company: publicCompany(company) });
  });

  // Turn a company on or off, allow auto-post, or change its name.
  app.put('/api/admin/companies/:id', requireAdmin, (req, res) => {
    const company = findCompany(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    const body = req.body || {};

    if (typeof body.name === 'string' && body.name.trim()) company.name = body.name.trim();
    if (typeof body.active === 'boolean') company.active = body.active;
    if (typeof body.auto_post_allowed === 'boolean') {
      company.auto_post_allowed = body.auto_post_allowed;
      // Taking the permission away also switches auto-post off straight away.
      if (!body.auto_post_allowed && company.auto_post) company.auto_post.enabled = false;
    }
    company.updated_at = new Date().toISOString();
    save();
    res.json({ company: publicCompany(company) });
  });

  // Set or clear the company's Anthropic API key. An empty value clears it.
  app.put('/api/admin/companies/:id/anthropic-key', requireAdmin, (req, res) => {
    const company = findCompany(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    const key = String(req.body?.api_key || '').trim();
    if (key && (key.length < 20 || /\s/.test(key))) {
      return res.status(400).json({ error: 'That does not look like an Anthropic API key.' });
    }
    try {
      setAnthropicKey(company, key);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    company.updated_at = new Date().toISOString();
    save();
    res.json({ company: publicCompany(company) });
  });

  // Add another login to an existing company.
  app.post('/api/admin/companies/:id/users', requireAdmin, (req, res) => {
    const company = findCompany(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!email.includes('@')) return res.status(400).json({ error: 'Enter a valid email.' });
    if (emailTaken(email)) return res.status(400).json({ error: 'That email already has an account.' });
    const pwError = passwordError(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const user = {
      id: newId(),
      company_id: company.id,
      email,
      name,
      password: hashPassword(password),
      role: 'customer',
      active: true,
    };
    db().users.push(user);
    save();
    res.status(201).json({ user: publicUserRecord(user) });
  });

  // Enable or disable a login, or reset its password.
  app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
    const user = db().users.find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const body = req.body || {};

    if (user.id === req.user.id && body.active === false) {
      return res.status(400).json({ error: 'You cannot disable your own login.' });
    }
    if (typeof body.active === 'boolean') user.active = body.active;
    if (body.password) {
      const pwError = passwordError(body.password);
      if (pwError) return res.status(400).json({ error: pwError });
      user.password = hashPassword(String(body.password));
    }
    save();
    res.json({ user: publicUserRecord(user) });
  });
}

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const path = require('node:path');

const cookieName = 'qh_session';
const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().min(10).max(72);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const teacherSchema = z.object({
  name: z.string().trim().min(1).max(120),
  hoursDue: z.number().min(0).max(200),
  lost: z.number().min(0).max(200).default(0),
  compensated: z.number().min(0).max(200).default(0),
  extra: z.number().min(0).max(200).default(0)
});
const ficheSchema = z.object({
  school: z.string().trim().max(160).default(''),
  teachers: z.array(teacherSchema).max(200).default([]),
  notes: z.string().max(2000).default('')
}).strict();

function createApp(db) {
  const app = express();
  const secret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-me');
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET doit contenir au moins 32 caractères en production.');

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const secureCookie = process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');
  const cookieOptions = { httpOnly: true, secure: secureCookie, sameSite: 'strict', path: '/', maxAge: (Number(process.env.JWT_DAYS) || 7) * 86400000 };
  const issueSession = (res, user) => res.cookie(cookieName, jwt.sign({ sub: String(user.id) }, secret, { expiresIn: `${Number(process.env.JWT_DAYS) || 7}d` }), cookieOptions);
  const requireAuth = (req, res, next) => {
    try {
      const payload = jwt.verify(req.cookies[cookieName] || '', secret);
      const user = db.prepare('SELECT id, email, name, role, profile FROM users WHERE id = ?').get(Number(payload.sub));
      if (!user) return res.status(401).json({ error: 'Session invalide.' });
      user.profile = JSON.parse(user.profile);
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Authentification requise.' });
    }
  };
  const requireAdmin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Accès réservé à l’inspection.' });

  app.use('/api', (req, res, next) => {
    if (writeMethods.has(req.method) && req.path !== '/auth/login' && req.path !== '/auth/register' && req.get('X-Requested-With') !== 'qh') {
      return res.status(403).json({ error: 'En-tête de protection requis.' });
    }
    next();
  });
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.post('/api/auth/register', (req, res) => {
    if (process.env.ALLOW_REGISTRATION === 'false') return res.status(403).json({ error: 'Les inscriptions sont désactivées.' });
    const parsed = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().min(2).max(120) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Vérifiez le nom, l’adresse e-mail et le mot de passe (10 caractères minimum).' });
    try {
      const { email, password, name } = parsed.data;
      const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, bcrypt.hashSync(password, 12), name);
      const user = { id: Number(result.lastInsertRowid), email, name, role: 'director', profile: {} };
      issueSession(res, user);
      res.status(201).json({ user });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
      throw error;
    }
  });
  app.post('/api/auth/login', (req, res) => {
    const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(72) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Adresse e-mail ou mot de passe invalide.' });
    const user = db.prepare('SELECT id, email, name, role, profile, password_hash FROM users WHERE email = ?').get(parsed.data.email);
    if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) return res.status(401).json({ error: 'Adresse e-mail ou mot de passe invalide.' });
    delete user.password_hash;
    user.profile = JSON.parse(user.profile);
    issueSession(res, user);
    res.json({ user });
  });
  app.post('/api/auth/logout', (req, res) => res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined }).json({ ok: true }));
  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
  app.put('/api/auth/me', requireAuth, (req, res) => {
    const parsed = z.object({ name: z.string().trim().min(2).max(120), profile: z.object({ ia: z.string().max(120).default(''), ief: z.string().max(120).default(''), codec: z.string().max(120).default(''), school: z.string().max(160).default('') }).strict() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Profil invalide.' });
    db.prepare('UPDATE users SET name = ?, profile = ? WHERE id = ?').run(parsed.data.name, JSON.stringify(parsed.data.profile), req.user.id);
    res.json({ user: { ...req.user, ...parsed.data } });
  });
  app.put('/api/auth/me/password', requireAuth, (req, res) => {
    const parsed = z.object({ currentPassword: z.string().min(1).max(72), newPassword: passwordSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 10 caractères.' });
    const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(parsed.data.currentPassword, current.password_hash)) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(parsed.data.newPassword, 12), req.user.id);
    res.json({ ok: true });
  });

  const parseFiche = (row) => ({ id: row.id, month: row.month, updatedAt: row.updated_at, ...JSON.parse(row.data) });
  const addCalculations = (fiche) => ({ ...fiche, teachers: fiche.teachers.map((teacher) => ({ ...teacher, hoursRealized: Math.max(0, teacher.hoursDue - teacher.lost + teacher.compensated + teacher.extra) })) });
  app.get('/api/fiches', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT id, month, data, updated_at FROM fiches WHERE user_id = ? ORDER BY month DESC').all(req.user.id);
    res.json({ fiches: rows.map((row) => ({ id: row.id, month: row.month, school: JSON.parse(row.data).school || '', updatedAt: row.updated_at })) });
  });
  app.post('/api/fiches', requireAuth, (req, res) => {
    const parsed = z.object({ mois: monthSchema, copier: z.boolean().default(false) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Mois invalide.' });
    let data = { school: req.user.profile.school || '', teachers: [], notes: '' };
    if (parsed.data.copier) {
      const previous = db.prepare('SELECT data FROM fiches WHERE user_id = ? AND month < ? ORDER BY month DESC LIMIT 1').get(req.user.id, parsed.data.mois);
      if (previous) data = { ...data, ...JSON.parse(previous.data), teachers: JSON.parse(previous.data).teachers.map((teacher) => ({ ...teacher, lost: 0, compensated: 0, extra: 0 })) };
    }
    try {
      const result = db.prepare('INSERT INTO fiches (user_id, month, data) VALUES (?, ?, ?)').run(req.user.id, parsed.data.mois, JSON.stringify(data));
      res.status(201).json({ fiche: addCalculations({ id: Number(result.lastInsertRowid), month: parsed.data.mois, ...data }) });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Une fiche existe déjà pour ce mois.' });
      throw error;
    }
  });
  app.get('/api/fiches/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT id, user_id, month, data, updated_at FROM fiches WHERE id = ?').get(Number(req.params.id));
    if (!row || (row.user_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Fiche introuvable.' });
    res.json({ fiche: addCalculations(parseFiche(row)) });
  });
  app.put('/api/fiches/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT id, user_id, month FROM fiches WHERE id = ?').get(Number(req.params.id));
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Fiche introuvable.' });
    const parsed = ficheSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Contenu de la fiche invalide.' });
    db.prepare('UPDATE fiches SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(parsed.data), row.id);
    res.json({ fiche: addCalculations({ id: row.id, month: row.month, ...parsed.data }) });
  });
  app.delete('/api/fiches/:id', requireAuth, (req, res) => {
    const result = db.prepare('DELETE FROM fiches WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Fiche introuvable.' });
    res.json({ ok: true });
  });
  app.get('/api/admin/fiches', requireAuth, requireAdmin, (req, res) => {
    const parsedMonth = req.query.mois === undefined ? undefined : monthSchema.safeParse(req.query.mois);
    if (parsedMonth && !parsedMonth.success) return res.status(400).json({ error: 'Mois invalide.' });
    const rows = parsedMonth
      ? db.prepare('SELECT fiches.id, fiches.month, fiches.data, fiches.updated_at, users.name, users.email FROM fiches JOIN users ON users.id = fiches.user_id WHERE fiches.month = ? ORDER BY users.name').all(parsedMonth.data)
      : db.prepare('SELECT fiches.id, fiches.month, fiches.data, fiches.updated_at, users.name, users.email FROM fiches JOIN users ON users.id = fiches.user_id ORDER BY fiches.month DESC, users.name').all();
    res.json({ fiches: rows.map((row) => ({ ...addCalculations(parseFiche(row)), director: row.name, email: row.email })) });
  });
  app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY name').all();
    res.json({ users });
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    res.status(500).json({ error: 'Une erreur interne est survenue.' });
  });
  return app;
}

module.exports = { createApp };
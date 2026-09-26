
'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const nodemailer = require('nodemailer');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || IS_PRODUCTION;
const SESSION_COOKIE_NAME = COOKIE_SECURE ? '__Host-ha_session' : 'ha_session';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

for (const dir of [DATA_DIR, UPLOAD_DIR, path.join(UPLOAD_DIR, 'portfolio'), path.join(UPLOAD_DIR, 'requests')]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
app.disable('x-powered-by');
const TRUST_PROXY = process.env.TRUST_PROXY === undefined ? 1 : process.env.TRUST_PROXY;
app.set('trust proxy', TRUST_PROXY);

const db = new Database(path.join(DATA_DIR, 'ha_visuel_studio.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  csrf_token TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price TEXT NOT NULL,
  unit TEXT DEFAULT '',
  description TEXT DEFAULT '',
  featured INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT DEFAULT '',
  company TEXT DEFAULT '',
  service_id INTEGER,
  service_name TEXT DEFAULT '',
  budget TEXT DEFAULT '',
  deadline TEXT DEFAULT '',
  contact_method TEXT DEFAULT 'WhatsApp',
  project_title TEXT NOT NULL,
  project_message TEXT NOT NULL,
  reference TEXT DEFAULT '',
  attachment_filename TEXT DEFAULT '',
  attachment_original_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Nouveau',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
try { db.exec("ALTER TABLE sessions ADD COLUMN csrf_token TEXT NOT NULL DEFAULT ''"); } catch (_) {}

const DEFAULT_SERVICES = [
  ['Affiche professionnelle', 'Design', '5000', 'FCFA / création', 'Affiche, flyer ou visuel promotionnel prêt pour le web et l’impression.', 1],
  ['Logo & identité visuelle', 'Branding', '25000', 'FCFA / projet', 'Logo, déclinaisons et base d’identité visuelle selon votre activité.', 0],
  ['Pack réseaux sociaux', 'Digital', '15000', 'FCFA / pack', 'Créations adaptées à WhatsApp, Facebook, Instagram et autres formats.', 0],
  ['Photographie', 'Photo', 'Sur devis', '', 'Portraits, produits, événements et contenus professionnels.', 0],
  ['Montage vidéo', 'Vidéo', '20000', 'FCFA / projet', 'Montage vidéo, formats courts, réseaux sociaux et contenus promotionnels.', 1],
  ['Clip / contenu vidéo', 'Vidéo', '35000', 'FCFA / projet', 'Création de contenus vidéo selon scénario, tournage et montage défini au brief.', 0]
];
if (db.prepare('SELECT COUNT(*) AS c FROM services').get().c === 0) {
  const insert = db.prepare(`INSERT INTO services
    (title,category,price,unit,description,featured,active,created_at)
    VALUES (?,?,?,?,?,?,1,?)`);
  const now = Date.now();
  const tx = db.transaction(() => DEFAULT_SERVICES.forEach(s => insert.run(...s, now)));
  tx();
}
const DEFAULT_SETTINGS = {
  whatsapp: '22677967567',
  email: 'contact@havisuelstudio.com',
  address: 'Orodara, Burkina Faso',
  hours: 'Sur demande — projet par projet'
};
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(key, value);
}
const DEFAULT_TESTIMONIALS = [
  ['Client H.A', 'Projet créatif', 'Une identité visuelle plus claire et plus professionnelle pour notre communication.'],
  ['Client H.A', 'Événement', 'Le brief et les échanges nous ont permis d’obtenir un visuel adapté à notre besoin.'],
  ['Client H.A', 'Communication', 'Un travail orienté vers un rendu propre, lisible et utilisable sur nos supports.']
];
if (db.prepare('SELECT COUNT(*) AS c FROM testimonials').get().c === 0) {
  const stmt = db.prepare('INSERT INTO testimonials(name,role,text,created_at) VALUES(?,?,?,?)');
  const tx = db.transaction(() => DEFAULT_TESTIMONIALS.forEach(row => stmt.run(...row, Date.now())));
  tx();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, storedHash) {
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHash, 'hex');
  return stored.length === derived.length && crypto.timingSafeEqual(derived, stored);
}
function publicUrl(filename) {
  return `/uploads/${filename}`;
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function sanitizeText(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}
function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function initAdmin() {
  const existing = db.prepare('SELECT id FROM admins WHERE username=?').get(ADMIN_USERNAME);
  if (existing) return;
  const initial = process.env.ADMIN_PASSWORD;
  if (!initial || initial.length < 12) {
    throw new Error('ADMIN_PASSWORD doit être défini dans .env et contenir au moins 12 caractères.');
  }
  const { salt, hash } = hashPassword(initial);
  db.prepare('INSERT INTO admins(username,password_hash,salt,created_at) VALUES(?,?,?,?)')
    .run(ADMIN_USERNAME, hash, salt, new Date().toISOString());
  console.log(`Compte administrateur initialisé : ${ADMIN_USERNAME}`);
}

const publicRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false
});
const requestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes depuis cette adresse. Réessayez plus tard.' }
});
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez plus tard.' }
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-site' }
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
setInterval(cleanupSessions, 15 * 60 * 1000).unref();

function readSessionToken(req) {
  const cookie = req.headers.cookie || '';
  const names = [SESSION_COOKIE_NAME, '__Host-ha_session', 'ha_session'];
  for (const name of names) {
    const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}
function sessionUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.id, s.username, s.csrf_token, s.expires_at, a.id AS admin_id
    FROM sessions s JOIN admins a ON a.username=s.username
    WHERE s.token_hash=? AND s.expires_at>?
  `).get(tokenHash(token), Date.now());
  return row || null;
}
function requireAdmin(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié.' });
  req.admin = user;
  next();
}
function setSessionCookie(res, token) {
  const secure = COOKIE_SECURE ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`);
}
function clearSessionCookie(res) {
  const secure = COOKIE_SECURE ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
function requestOriginIsSame(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  const proto = req.get('x-forwarded-proto')?.split(',')[0].trim() || req.protocol;
  const host = req.get('x-forwarded-host')?.split(',')[0].trim() || req.get('host');
  return origin === `${proto}://${host}`;
}
function requireCsrf(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if (!requestOriginIsSame(req)) return res.status(403).json({ error: 'Origine de requête refusée.' });
  const token = readSessionToken(req);
  const session = sessionUser(req);
  const supplied = req.get('x-csrf-token') || req.body?._csrf;
  const providedBuffer = Buffer.from(String(supplied || ''));
  const expectedBuffer = Buffer.from(String(session?.csrf_token || ''));
  const validToken = providedBuffer.length === expectedBuffer.length && providedBuffer.length > 0 && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  if (!session || !token || !supplied || supplied.length > 200 || !validToken) {
    return res.status(403).json({ error: 'Jeton CSRF invalide ou absent.' });
  }
  next();
}

function isDocxZip(buffer) {
  const text = buffer.toString('latin1');
  return text.includes('[Content_Types].xml') && text.includes('word/document.xml') && !text.includes('vbaProject.bin');
}
async function detectFileType(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4100);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const b = buffer.subarray(0, bytesRead);
    const starts = (...bytes) => bytes.every((v, i) => b[i] === v);
    if (starts(0xFF,0xD8,0xFF)) return 'image/jpeg';
    if (starts(0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A)) return 'image/png';
    if (starts(0x47,0x49,0x46,0x38)) return 'image/gif';
    if (b.length >= 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP') return 'image/webp';
    if (b.length >= 12 && b.toString('ascii',4,8) === 'ftyp') {
      const brand = b.toString('ascii',8,12);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
      if (brand === 'qt  ') return 'video/quicktime';
      return 'video/mp4';
    }
    if (starts(0x1A,0x45,0xDF,0xA3)) return 'video/webm';
    if (starts(0x25,0x50,0x44,0x46,0x2D)) return 'application/pdf';
    if (starts(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1)) return 'application/msword';
    if (starts(0x50,0x4B,0x03,0x04)) {
      const full = await fsp.readFile(filePath);
      return isDocxZip(full) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/zip';
    }
    return null;
  } finally { await handle.close(); }
}
async function validateUploadedFile(file, allowedKinds) {
  const detected = await detectFileType(file.path);
  const ok = detected && allowedKinds.has(detected);
  if (!ok) {
    await fsp.unlink(file.path).catch(() => {});
    throw new Error('Le contenu réel du fichier ne correspond pas à un format autorisé.');
  }
  return detected;
}

const portfolioStorage = multer.diskStorage({
  destination: path.join(UPLOAD_DIR, 'portfolio'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
const requestStorage = multer.diskStorage({
  destination: path.join(UPLOAD_DIR, 'requests'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
const portfolioUpload = multer({
  storage: portfolioStorage,
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/(jpeg|png|gif|webp|avif)$|video\/(mp4|webm|quicktime)$|application\/pdf$)/.test(file.mimetype);
    cb(ok ? null : new Error('Type de fichier non autorisé.'), ok);
  }
});
const requestUpload = multer({
  storage: requestStorage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/|application\/pdf$|application\/msword$|application\/vnd.openxmlformats-officedocument.wordprocessingml.document$)/.test(file.mimetype);
    cb(ok ? null : new Error('Type de pièce jointe non autorisé.'), ok);
  }
});

app.use('/uploads/portfolio', express.static(path.join(UPLOAD_DIR, 'portfolio'), {
  index: false,
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; object-src 'none';");
  }
}));

app.get('/api/public/bootstrap', publicRateLimit, (_req, res) => {
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x => [x.key, x.value]));
  const services = db.prepare('SELECT id,title,category,price,unit,description,featured FROM services WHERE active=1 ORDER BY featured DESC, id ASC').all();
  const portfolio = db.prepare('SELECT id,title,category,description,filename,original_name,mime,size,created_at FROM portfolio ORDER BY id DESC').all()
    .map(x => ({ ...x, url: publicUrl(x.filename) }));
  const testimonials = db.prepare('SELECT id,name,role,text,created_at FROM testimonials ORDER BY id DESC').all();
  res.json({ settings, services, portfolio, testimonials });
});

app.post('/api/auth/login', authRateLimit, (req, res) => {
  const username = sanitizeText(req.body.username, 100);
  const password = String(req.body.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !verifyPassword(password, admin.salt, admin.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,username,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)')
    .run(tokenHash(token), username, csrfToken, Date.now() + 8 * 60 * 60 * 1000, Date.now());
  setSessionCookie(res, token);
  res.json({ ok: true, username, csrfToken });
});

app.post('/api/auth/logout', requireAdmin, requireCsrf, (req, res) => {
  const token = readSessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ authenticated: true, username: req.admin.username, csrfToken: req.admin.csrf_token }));
app.get('/api/admin/csrf', requireAdmin, (req, res) => res.json({ csrfToken: req.admin.csrf_token }));

// Public project request: persisted server-side and optionally emailed.
app.post('/api/requests', requestRateLimit, requestUpload.single('attachment'), async (req, res) => {
  const name = sanitizeText(req.body.name, 120);
  const phone = sanitizeText(req.body.phone, 40);
  const email = sanitizeText(req.body.email, 160);
  const company = sanitizeText(req.body.company, 160);
  const serviceId = Number(req.body.serviceId || 0) || null;
  const service = serviceId ? db.prepare('SELECT id,title FROM services WHERE id=? AND active=1').get(serviceId) : null;
  const serviceName = service?.title || '';
  const consent = String(req.body.consent || '').toLowerCase() === 'true';
  const budget = sanitizeText(req.body.budget, 120);
  const deadline = sanitizeText(req.body.deadline, 40);
  const contactMethod = sanitizeText(req.body.contactMethod, 40);
  const projectTitle = sanitizeText(req.body.projectTitle, 180);
  const projectMessage = sanitizeText(req.body.projectMessage, 5000);
  const reference = sanitizeText(req.body.reference, 500);

  if (!name || !phone || !projectTitle || !projectMessage || !consent) {
    if (req.file) await fsp.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Nom, téléphone, projet, description et consentement sont obligatoires.' });
  }
  if (!validEmail(email)) {
    if (req.file) await fsp.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }
  if (req.file) {
    try {
      const detected = await validateUploadedFile(req.file, new Set(['image/jpeg','image/png','image/gif','image/webp','application/pdf','application/msword','application/zip']));
      const allowed = new Set(['image/jpeg','image/png','image/gif','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
      if (!allowed.has(detected) && detected !== 'application/zip') throw new Error('Format de pièce jointe non autorisé.');
      if (detected === 'application/zip' && !/\.docx$/i.test(req.file.originalname)) throw new Error('Le fichier ZIP n’est autorisé que pour un document DOCX.');
    } catch (error) {
      await fsp.unlink(req.file.path).catch(()=>{});
      return res.status(400).json({ error: error.message });
    }
  }
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO requests
    (name,phone,email,company,service_id,service_name,budget,deadline,contact_method,project_title,project_message,reference,attachment_filename,attachment_original_name,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    name, phone, email, company, serviceId, serviceName, budget, deadline,
    contactMethod, projectTitle, projectMessage, reference,
    req.file ? `requests/${path.basename(req.file.filename)}` : '',
    req.file ? req.file.originalname : '',
    'Nouveau', now
  );

  await notifyByEmail({ id: result.lastInsertRowid, name, phone, email, projectTitle, projectMessage, serviceName, budget });
  const whatsapp = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp')?.value || '22677967567';
  res.status(201).json({ ok: true, id: result.lastInsertRowid, whatsapp });
});

let mailTransporter = null;
async function notifyByEmail(project) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !NOTIFY_EMAIL) return;
  try {
    mailTransporter ||= nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: Number(SMTP_PORT || 587) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await mailTransporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: NOTIFY_EMAIL,
      subject: `Nouvelle demande — ${project.projectTitle}`,
      text: [
        `Demande #${project.id}`,
        `Nom: ${project.name}`,
        `Téléphone: ${project.phone}`,
        `Email: ${project.email || '—'}`,
        `Service: ${project.serviceName || '—'}`,
        `Budget: ${project.budget || '—'}`,
        '',
        project.projectMessage
      ].join('\n')
    });
  } catch (error) {
    console.error('Notification email échouée:', error.message);
  }
}

app.use('/api/admin', requireAdmin);
app.use('/api/admin', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api/admin', requireCsrf);

app.get('/api/admin/services', (req,res) => res.json(db.prepare('SELECT * FROM services ORDER BY featured DESC,id ASC').all()));
app.post('/api/admin/services', (req,res) => {
  const {title,category,price,unit,description,featured,active} = req.body;
  if (!sanitizeText(title,160)) return res.status(400).json({error:'Nom de service obligatoire.'});
  const r=db.prepare(`INSERT INTO services(title,category,price,unit,description,featured,active,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(sanitizeText(title,160),sanitizeText(category,50),sanitizeText(price,80),sanitizeText(unit,80),sanitizeText(description,1000),featured?1:0,active===false?0:1,Date.now());
  res.status(201).json({id:r.lastInsertRowid});
});
app.put('/api/admin/services/:id', (req,res) => {
  const {title,category,price,unit,description,featured,active} = req.body;
  const id=Number(req.params.id);
  db.prepare(`UPDATE services SET title=?,category=?,price=?,unit=?,description=?,featured=?,active=? WHERE id=?`)
    .run(sanitizeText(title,160),sanitizeText(category,50),sanitizeText(price,80),sanitizeText(unit,80),sanitizeText(description,1000),featured?1:0,active===false?0:1,id);
  res.json({ok:true});
});
app.delete('/api/admin/services/:id', (req,res) => {
  db.prepare('DELETE FROM services WHERE id=?').run(Number(req.params.id));
  res.json({ok:true});
});

app.get('/api/admin/portfolio', (req,res) => {
  const rows=db.prepare('SELECT * FROM portfolio ORDER BY id DESC').all().map(x=>({...x,url:publicUrl(x.filename)}));
  res.json(rows);
});
app.post('/api/admin/portfolio', portfolioUpload.array('files',10), async (req,res) => {
  const title=sanitizeText(req.body.title,180);
  const category=sanitizeText(req.body.category,50);
  const description=sanitizeText(req.body.description,1000);
  if(!req.files?.length) return res.status(400).json({error:'Aucun fichier reçu.'});
  try {
    for (const file of req.files) {
      const detected = await validateUploadedFile(file, new Set(['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime','application/pdf']));
      file.mimetype = detected;
    }
  } catch (error) {
    for (const file of req.files) await fsp.unlink(file.path).catch(()=>{});
    return res.status(400).json({error:error.message});
  }
  const stmt=db.prepare(`INSERT INTO portfolio(title,category,description,filename,original_name,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)`);
  const rows=[];
  try {
    const tx=db.transaction(() => req.files.forEach(file=>{
      const r=stmt.run(title || path.parse(file.originalname).name,category,description,`portfolio/${path.basename(file.filename)}`,file.originalname,file.mimetype,file.size,Date.now());
      rows.push(r.lastInsertRowid);
    }));
    tx();
  } catch (error) {
    for(const file of req.files) await fsp.unlink(file.path).catch(()=>{});
    return res.status(500).json({error:'Impossible d’enregistrer les médias.'});
  }
  res.status(201).json({ok:true,ids:rows});
});
app.delete('/api/admin/portfolio/:id', async (req,res) => {
  const row=db.prepare('SELECT filename FROM portfolio WHERE id=?').get(Number(req.params.id));
  if(row){
    await fsp.unlink(path.join(UPLOAD_DIR,row.filename)).catch(()=>{});
    db.prepare('DELETE FROM portfolio WHERE id=?').run(Number(req.params.id));
  }
  res.json({ok:true});
});
app.delete('/api/admin/portfolio', async (req,res) => {
  const rows = db.prepare('SELECT filename FROM portfolio').all();
  for (const row of rows) await fsp.unlink(path.join(UPLOAD_DIR, row.filename)).catch(()=>{});
  db.prepare('DELETE FROM portfolio').run();
  res.json({ok:true, deleted:rows.length});
});

app.get('/api/admin/requests', (req,res) => {
  const rows=db.prepare('SELECT * FROM requests ORDER BY id DESC').all().map(x=>({
    ...x,
    attachment_url:x.attachment_filename?`/api/admin/requests/${x.id}/attachment`:'',
  }));
  res.json(rows);
});
app.patch('/api/admin/requests/:id/status', (req,res) => {
  const status=String(req.body.status||'');
  if(!['Nouveau','En cours','Terminé','Annulé'].includes(status)) return res.status(400).json({error:'Statut invalide.'});
  db.prepare('UPDATE requests SET status=? WHERE id=?').run(status,Number(req.params.id));
  res.json({ok:true});
});
app.delete('/api/admin/requests/:id', (req,res) => {
  const row=db.prepare('SELECT attachment_filename FROM requests WHERE id=?').get(Number(req.params.id));
  if(row?.attachment_filename) fsp.unlink(path.join(UPLOAD_DIR,row.attachment_filename)).catch(()=>{});
  db.prepare('DELETE FROM requests WHERE id=?').run(Number(req.params.id));
  res.json({ok:true});
});

app.get('/api/admin/requests/:id/attachment', async (req,res) => {
  const row = db.prepare('SELECT attachment_filename,attachment_original_name FROM requests WHERE id=?').get(Number(req.params.id));
  if (!row?.attachment_filename) return res.status(404).json({error:'Pièce jointe introuvable.'});
  const safeRelative = row.attachment_filename.replace(/^[/\\]+/, '');
  const filePath = path.join(UPLOAD_DIR, safeRelative);
  const resolved = path.resolve(filePath);
  const privateRoot = path.resolve(path.join(UPLOAD_DIR, 'requests'));
  if (!resolved.startsWith(privateRoot + path.sep)) return res.status(404).end();
  try {
    await fsp.access(resolved, fs.constants.R_OK);
  } catch {
    return res.status(404).json({error:'Fichier introuvable.'});
  }
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.attachment_original_name || path.basename(resolved))}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(resolved);
});

app.get('/api/admin/requests.csv', (req,res) => {
  const rows=db.prepare('SELECT * FROM requests ORDER BY id DESC').all();
  const headers=['date','nom','telephone','email','entreprise','service','budget','deadline','projet','statut','description'];
  const quote=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const csv=[headers.join(';'),...rows.map(r=>[
    new Date(r.created_at).toLocaleDateString('fr-FR'),r.name,r.phone,r.email,r.company,r.service_name,r.budget,r.deadline,r.project_title,r.status,r.project_message
  ].map(quote).join(';'))].join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="HA_VISUEL_STUDIO_demandes.csv"');
  res.send('\ufeff'+csv);
});

app.get('/api/admin/testimonials', (req,res)=>res.json(db.prepare('SELECT * FROM testimonials ORDER BY id DESC').all()));
app.post('/api/admin/testimonials', (req,res)=>{
  const name=sanitizeText(req.body.name,120),role=sanitizeText(req.body.role,120),text=sanitizeText(req.body.text,1000);
  if(!name||!text)return res.status(400).json({error:'Nom et avis obligatoires.'});
  const r=db.prepare('INSERT INTO testimonials(name,role,text,created_at) VALUES(?,?,?,?)').run(name,role,text,Date.now());
  res.status(201).json({id:r.lastInsertRowid});
});
app.delete('/api/admin/testimonials/:id',(req,res)=>{db.prepare('DELETE FROM testimonials WHERE id=?').run(Number(req.params.id));res.json({ok:true})});

app.get('/api/admin/settings',(req,res)=>res.json(Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]))));
app.put('/api/admin/settings',(req,res)=>{
  const allowed=['whatsapp','email','address','hours'];
  for(const key of allowed){
    if(req.body[key]!==undefined)db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,sanitizeText(req.body[key],300));
  }
  res.json({ok:true});
});
app.post('/api/admin/password',(req,res)=>{
  const username=req.admin.username;
  const row=db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  const current=String(req.body.currentPassword||''), next=String(req.body.newPassword||'');
  if(!verifyPassword(current,row.salt,row.password_hash)) return res.status(401).json({error:'Mot de passe actuel incorrect.'});
  if(next.length<12) return res.status(400).json({error:'Le nouveau mot de passe doit contenir au moins 12 caractères.'});
  const {salt,hash}=hashPassword(next);
  db.prepare('UPDATE admins SET password_hash=?,salt=? WHERE username=?').run(hash,salt,username);
  db.prepare('DELETE FROM sessions WHERE username=?').run(username);
  const token=crypto.randomBytes(32).toString('base64url');
  const csrfToken=crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,username,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)').run(tokenHash(token),username,csrfToken,Date.now()+8*60*60*1000,Date.now());
  setSessionCookie(res,token);
  res.json({ok:true,csrfToken});
});
app.get('/api/admin/backup.json',(req,res)=>{
  const payload={
    exported_at:new Date().toISOString(),
    services:db.prepare('SELECT * FROM services').all(),
    requests:db.prepare('SELECT * FROM requests').all(),
    testimonials:db.prepare('SELECT * FROM testimonials').all(),
    settings:db.prepare('SELECT * FROM settings').all()
  };
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="HA_VISUEL_STUDIO_backup.json"');
  res.send(JSON.stringify(payload,null,2));
});

app.post('/api/admin/backup/import', (req,res) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.services) || !Array.isArray(payload.testimonials) || !Array.isArray(payload.settings)) {
    return res.status(400).json({error:'Fichier de sauvegarde invalide.'});
  }
  if (payload.services.length > 500 || payload.testimonials.length > 500 || payload.settings.length > 100) return res.status(400).json({error:'Sauvegarde trop volumineuse.'});
  try {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM services').run();
      db.prepare('DELETE FROM testimonials').run();
      db.prepare('DELETE FROM settings').run();
      const serviceStmt=db.prepare('INSERT INTO services(id,title,category,price,unit,description,featured,active,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
      for(const x of payload.services){
        if(!x.title) throw new Error('Service invalide dans la sauvegarde.');
        serviceStmt.run(Number(x.id)||undefined,sanitizeText(x.title,160),sanitizeText(x.category,50),sanitizeText(x.price,80),sanitizeText(x.unit,80),sanitizeText(x.description,1000),x.featured?1:0,x.active===0?0:1,Number(x.created_at)||Date.now());
      }
      const testStmt=db.prepare('INSERT INTO testimonials(id,name,role,text,created_at) VALUES(?,?,?,?,?)');
      for(const x of payload.testimonials){
        if(!x.name || !x.text) throw new Error('Avis invalide dans la sauvegarde.');
        testStmt.run(Number(x.id)||undefined,sanitizeText(x.name,120),sanitizeText(x.role,120),sanitizeText(x.text,1000),Number(x.created_at)||Date.now());
      }
      const settingStmt=db.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
      for(const x of payload.settings){
        if(!x.key) continue;
        settingStmt.run(sanitizeText(x.key,80),sanitizeText(x.value,500));
      }
    });
    tx();
    res.json({ok:true});
  } catch(error) {
    console.error('Import backup échoué:', error);
    res.status(400).json({error:'Impossible de restaurer cette sauvegarde.'});
  }
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get(/^(?!\/api\/|\/uploads\/).*/, (req,res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(404).end();
  res.sendFile(path.join(PUBLIC_DIR,'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({error:`Upload: ${err.message}`});
  if (err?.message === 'Type de fichier non autorisé.' || err?.message === 'Type de pièce jointe non autorisé.' || err?.message?.includes('contenu réel du fichier'))
    return res.status(400).json({error:err.message});
  res.status(500).json({error:'Erreur serveur.'});
});

initAdmin().then(() => {
  app.listen(PORT, () => console.log(`H.A VISUEL STUDIO → http://localhost:${PORT}`));
}).catch(error => {
  console.error('Démarrage impossible:', error.message);
  process.exit(1);
});

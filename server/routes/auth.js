const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb, generateReferralCode } = require('../db');
const { generateToken, authMiddleware } = require('../middleware/auth');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'meecart_salt').digest('hex');
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendSMS(phone, code, purpose) {
  const messages = {
    signup: `Your Meecart signup OTP is ${code}. Valid for 5 minutes.`,
    forgot: `Your Meecart password reset OTP is ${code}. Valid for 5 minutes.`,
  };
  console.log(`\n📱 OTP for ${phone} [${purpose}]: ${code}\n`);
}

// ── POST /api/auth/send-otp ──────────────────────────
// purpose: 'signup' | 'forgot'
router.post('/send-otp', (req, res) => {
  const { phone, purpose = 'signup' } = req.body;

  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Valid 10-digit phone number required' });
  }

  const db = getDb();

  // For signup: check phone not already registered
  if (purpose === 'signup') {
    const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (existing) {
      return res.status(400).json({ error: 'Phone number already registered. Please login.' });
    }
  }

  // For forgot: check phone exists
  if (purpose === 'forgot') {
    const existing = db.prepare('SELECT id FROM users WHERE phone = ? AND role = ?').get(phone, 'customer');
    if (!existing) {
      return res.status(400).json({ error: 'No account found with this phone number.' });
    }
  }

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  db.prepare('UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0 AND purpose = ?').run(phone, purpose);
  db.prepare('INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES (?, ?, ?, ?)').run(phone, code, purpose, expiresAt);

  sendSMS(phone, code, purpose);

  res.json({ message: 'OTP sent successfully', phone });
});

// ── POST /api/auth/verify-otp ────────────────────────
// Just verify OTP, return verified token (not full login)
router.post('/verify-otp', (req, res) => {
  const { phone, code, purpose = 'signup' } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and OTP required' });
  }

  const db = getDb();

  const otp = db.prepare(`
    SELECT * FROM otp_codes
    WHERE phone = ? AND code = ? AND purpose = ? AND used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(phone, code, purpose);

  if (!otp) {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }

  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otp.id);

  res.json({ message: 'OTP verified', phone, verified: true });
});

// ── POST /api/auth/signup ────────────────────────────
router.post('/signup', (req, res) => {
  const { phone, name, address, password, referral_code } = req.body;

  if (!phone || !name || !address || !password) {
    return res.status(400).json({ error: 'Phone, name, address and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return res.status(400).json({ error: 'Phone already registered. Please login.' });
  }

  const hashedPassword = hashPassword(password);
  const myReferralCode = generateReferralCode(phone);

  const result = db.prepare(`
    INSERT INTO users (phone, name, address, password, referral_code, referred_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(phone, name.trim(), address.trim(), hashedPassword, myReferralCode, referral_code || null);

  const user = db.prepare('SELECT id, phone, name, address, role, referral_code FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = generateToken(user);

  res.status(201).json({
    message: 'Account created successfully',
    token,
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, referral_code: user.referral_code }
  });
});

// ── POST /api/auth/login ─────────────────────────────
router.post('/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

  if (!user) {
    return res.status(401).json({ error: 'No account found. Please register first.' });
  }

  // Admin login — no password needed (uses OTP flow separately)
  if (user.role === 'admin') {
    return res.status(401).json({ error: 'Admin login not allowed here.' });
  }

  if (!user.password) {
    return res.status(401).json({ error: 'Please reset your password first.' });
  }

  const hashedPassword = hashPassword(password);
  if (hashedPassword !== user.password) {
    return res.status(401).json({ error: 'Incorrect password. Try again.' });
  }

  const token = generateToken(user);

  res.json({
    message: 'Login successful',
    token,
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role }
  });
});

// ── POST /api/auth/admin-login ───────────────────────
router.post('/admin-login', (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and OTP required' });
  }

  const db = getDb();

  const otp = db.prepare(`
    SELECT * FROM otp_codes
    WHERE phone = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(phone, code);

  if (!otp) {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }

  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otp.id);

  const user = db.prepare('SELECT * FROM users WHERE phone = ? AND role = ?').get(phone, 'admin');
  if (!user) {
    return res.status(403).json({ error: 'Not an admin account' });
  }

  const token = generateToken(user);
  res.json({ message: 'Admin login successful', token, user: { id: user.id, phone: user.phone, name: user.name, role: user.role } });
});

// ── POST /api/auth/reset-password ───────────────────
router.post('/reset-password', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and new password required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (!user) {
    return res.status(404).json({ error: 'Account not found' });
  }

  const hashedPassword = hashPassword(password);
  db.prepare('UPDATE users SET password = ? WHERE phone = ?').run(hashedPassword, phone);

  res.json({ message: 'Password reset successfully' });
});

// ── GET /api/auth/me ─────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, phone, name, address, role, referral_code FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ── PUT /api/auth/profile ────────────────────────────
router.put('/profile', authMiddleware, (req, res) => {
  const { name, address } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET name = ?, address = ? WHERE id = ?').run(name, address, req.user.id);
  const user = db.prepare('SELECT id, phone, name, address, role FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

module.exports = router;
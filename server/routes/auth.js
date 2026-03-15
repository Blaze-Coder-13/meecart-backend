const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { generateToken, authMiddleware } = require('../middleware/auth');

// Generate a 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Simulate SMS send (replace with Twilio/MSG91 in production)
function sendSMS(phone, code) {
  console.log(`\n📱 OTP for ${phone}: ${code}\n`);
  // In production:
  // await twilioClient.messages.create({ to: phone, from: '+1...', body: `Your Meecart OTP: ${code}` })
}

// POST /api/auth/send-otp
router.post('/send-otp', (req, res) => {
  const { phone } = req.body;

  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Valid 10-digit phone number required' });
  }

  const db = getDb();
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

  // Invalidate any existing OTPs for this phone
  db.prepare('UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0').run(phone);

  // Store new OTP
  db.prepare('INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)').run(phone, code, expiresAt);

  // Send SMS (or log to console in dev)
  sendSMS(phone, code);

  res.json({ message: 'OTP sent successfully', phone });
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (req, res) => {
  const { phone, code, name } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and OTP code required' });
  }

  const db = getDb();

  // Check OTP
  const otp = db.prepare(`
    SELECT * FROM otp_codes
    WHERE phone = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(phone, code);

  if (!otp) {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }

  // Mark OTP as used
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otp.id);

  // Get or create user
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

  if (!user) {
    const result = db.prepare('INSERT INTO users (phone, name) VALUES (?, ?)').run(phone, name || null);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  } else if (name && !user.name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    user.name = name;
  }

  const token = generateToken(user);

  res.json({
    message: 'Login successful',
    token,
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role }
  });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, phone, name, address, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, (req, res) => {
  const { name, address } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET name = ?, address = ? WHERE id = ?').run(name, address, req.user.id);
  const user = db.prepare('SELECT id, phone, name, address, role FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

module.exports = router;

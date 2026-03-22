const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query, generateReferralCode } = require('../db');
const { generateToken, authMiddleware } = require('../middleware/auth');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'meecart_salt').digest('hex');
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendSMS(phone, code, purpose) {
  console.log(`\n📱 OTP for ${phone} [${purpose}]: ${code}\n`);
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  const { phone, purpose = 'signup' } = req.body;
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Valid 10-digit phone number required' });
  }

  try {
    if (purpose === 'signup') {
      const existing = await query('SELECT id FROM users WHERE phone = $1', [phone]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Phone number already registered. Please login.' });
      }
    }

    if (purpose === 'forgot') {
      const existing = await query("SELECT id FROM users WHERE phone = $1 AND role = 'customer'", [phone]);
      if (existing.rows.length === 0) {
        return res.status(400).json({ error: 'No account found with this phone number.' });
      }
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await query('UPDATE otp_codes SET used = 1 WHERE phone = $1 AND used = 0 AND purpose = $2', [phone, purpose]);
    await query('INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES ($1, $2, $3, $4)', [phone, code, purpose, expiresAt]);

    sendSMS(phone, code, purpose);
    res.json({ message: 'OTP sent successfully', phone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { phone, code, purpose = 'signup' } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and OTP required' });
  }

  try {
    const result = await query(`
      SELECT * FROM otp_codes
      WHERE phone = $1 AND code = $2 AND purpose = $3 AND used = 0 AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1
    `, [phone, code, purpose]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    await query('UPDATE otp_codes SET used = 1 WHERE id = $1', [result.rows[0].id]);
    res.json({ message: 'OTP verified', phone, verified: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { phone, name, address, password, referral_code } = req.body;

  if (!phone || !name || !address || !password) {
    return res.status(400).json({ error: 'Phone, name, address and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Phone already registered. Please login.' });
    }

    if (referral_code) {
      const referrer = await query('SELECT id FROM users WHERE referral_code = $1', [referral_code]);
      if (referrer.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid referral code. Please check and try again.' });
      }
    }

    const hashedPassword = hashPassword(password);
    const myReferralCode = generateReferralCode(phone);

    const result = await query(`
      INSERT INTO users (phone, name, address, password, referral_code, referred_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [phone, name.trim(), address.trim(), hashedPassword, myReferralCode, referral_code || null]);

    const user = result.rows[0];
    const token = generateToken(user);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role, referral_code: user.referral_code }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and password required' });
  }

  try {
    const result = await query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'No account found. Please register first.' });
    }

    const user = result.rows[0];

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/admin-login
router.post('/admin-login', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and OTP required' });
  }

  try {
    const result = await query(`
      SELECT * FROM otp_codes
      WHERE phone = $1 AND code = $2 AND used = 0 AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1
    `, [phone, code]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    await query('UPDATE otp_codes SET used = 1 WHERE id = $1', [result.rows[0].id]);

    const userResult = await query("SELECT * FROM users WHERE phone = $1 AND role = 'admin'", [phone]);
    if (userResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not an admin account' });
    }

    const user = userResult.rows[0];
    const token = generateToken(user);
    res.json({ message: 'Admin login successful', token, user: { id: user.id, phone: user.phone, name: user.name, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and new password required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const result = await query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const hashedPassword = hashPassword(password);
    await query('UPDATE users SET password = $1 WHERE phone = $2', [hashedPassword, phone]);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT id, phone, name, address, role, referral_code FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, async (req, res) => {
  const { name, address } = req.body;
  try {
    await query('UPDATE users SET name = $1, address = $2 WHERE id = $3', [name, address, req.user.id]);
    const result = await query('SELECT id, phone, name, address, role FROM users WHERE id = $1', [req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
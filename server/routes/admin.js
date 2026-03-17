const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/admin/users
router.get('/users', adminMiddleware, (req, res) => {
  const db = getDb();
  const { page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  const users = db.prepare(`
    SELECT u.id, u.phone, u.name, u.address, u.role, u.referral_code, u.created_at,
           COUNT(o.id) as order_count,
           COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.role = 'customer'
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'customer'").get().c;
  res.json({ users, total });
});

// GET /api/admin/dashboard
router.get('/dashboard', adminMiddleware, (req, res) => {
  const db = getDb();

  const stats = {
    total_orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    pending_orders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c,
    active_orders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('confirmed','packing','out_for_delivery')").get().c,
    delivered_today: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='delivered' AND date(updated_at)=date('now')").get().c,
    revenue_today: db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='delivered' AND date(updated_at)=date('now')").get().s,
    revenue_total: db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='delivered'").get().s,
    total_customers: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='customer'").get().c,
    total_products: db.prepare('SELECT COUNT(*) as c FROM products WHERE active=1').get().c,
    recent_orders: db.prepare(`
      SELECT o.id, o.status, o.total, o.created_at, u.phone, u.name as customer_name, u.address as customer_address
      FROM orders o JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC LIMIT 10
    `).all(),
    top_products: db.prepare(`
      SELECT p.name, p.image_emoji, SUM(oi.quantity) as total_sold
      FROM order_items oi JOIN products p ON oi.product_id = p.id
      GROUP BY p.id ORDER BY total_sold DESC LIMIT 5
    `).all(),
  };

  res.json(stats);
});

// ── CATEGORIES ────────────────────────────────────────

router.post('/categories', adminMiddleware, (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });
  const db = getDb();
  const result = db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)').run(name, icon || '🥦');
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(category);
});

router.put('/categories/:id', adminMiddleware, (req, res) => {
  const { name, icon, active } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  db.prepare('UPDATE categories SET name = COALESCE(?, name), icon = COALESCE(?, icon), active = COALESCE(?, active) WHERE id = ?')
    .run(name || null, icon || null, active !== undefined ? active : null, req.params.id);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json(category);
});

router.delete('/categories/:id', adminMiddleware, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE products SET active = 0 WHERE category_id = ?').run(req.params.id);
  res.json({ message: 'Category deleted' });
});

// ── SETTINGS ──────────────────────────────────────────

router.get('/settings', adminMiddleware, (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  settings.forEach(s => result[s.key] = s.value);
  res.json(result);
});

router.put('/settings', adminMiddleware, (req, res) => {
  const db = getDb();
  const updates = req.body;
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  const updateMany = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      update.run(key, String(value));
    }
  });
  updateMany(updates);
  res.json({ message: 'Settings updated' });
});

// ── BANNERS ───────────────────────────────────────────

router.get('/banners', adminMiddleware, (req, res) => {
  const db = getDb();
  const banners = db.prepare('SELECT * FROM banners ORDER BY created_at DESC').all();
  res.json(banners);
});

router.post('/banners', adminMiddleware, (req, res) => {
  const { title, image_url, product_id } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO banners (title, image_url, product_id) VALUES (?, ?, ?)').run(title || null, image_url || null, product_id || null);
  const banner = db.prepare('SELECT * FROM banners WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(banner);
});

router.put('/banners/:id', adminMiddleware, (req, res) => {
  const { active } = req.body;
  const db = getDb();
  db.prepare('UPDATE banners SET active = ? WHERE id = ?').run(active, req.params.id);
  res.json({ message: 'Banner updated' });
});

router.delete('/banners/:id', adminMiddleware, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  res.json({ message: 'Banner deleted' });
});

// Public banners for app
router.get('/banners/public', (req, res) => {
  const db = getDb();
  const banners = db.prepare('SELECT * FROM banners WHERE active = 1 ORDER BY created_at DESC').all();
  res.json(banners);
});

// ── PROMO CODES ───────────────────────────────────────

// GET all promo codes (admin)
router.get('/promos', adminMiddleware, (req, res) => {
  const db = getDb();
  const promos = db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all();
  res.json(promos);
});

// POST create promo code (admin)
router.post('/promos', adminMiddleware, (req, res) => {
  const { code, discount_type, discount_value, min_order_value, max_uses, expires_at } = req.body;
  if (!code || !discount_value) {
    return res.status(400).json({ error: 'Code and discount value required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM promo_codes WHERE code = ?').get(code.toUpperCase());
  if (existing) return res.status(400).json({ error: 'Promo code already exists' });

  const result = db.prepare(`
    INSERT INTO promo_codes (code, discount_type, discount_value, min_order_value, max_uses, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    code.toUpperCase(),
    discount_type || 'flat',
    Number(discount_value),
    Number(min_order_value) || 0,
    Number(max_uses) || 100,
    expires_at || null
  );

  const promo = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(promo);
});

// PUT toggle promo code active/inactive (admin)
router.put('/promos/:id', adminMiddleware, (req, res) => {
  const { active } = req.body;
  const db = getDb();
  db.prepare('UPDATE promo_codes SET active = ? WHERE id = ?').run(active, req.params.id);
  res.json({ message: 'Promo code updated' });
});

// DELETE promo code (admin)
router.delete('/promos/:id', adminMiddleware, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM promo_codes WHERE id = ?').run(req.params.id);
  res.json({ message: 'Promo code deleted' });
});

// POST apply promo code (customer)
router.post('/promos/apply', (req, res) => {
  const { code, order_total } = req.body;
  if (!code) return res.status(400).json({ error: 'Promo code required' });

  const db = getDb();
  const promo = db.prepare(`
    SELECT * FROM promo_codes
    WHERE code = ? AND active = 1
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    AND used_count < max_uses
  `).get(code.toUpperCase());

  if (!promo) return res.status(400).json({ error: 'Invalid or expired promo code' });

  if (order_total < promo.min_order_value) {
    return res.status(400).json({ error: `Minimum order ₹${promo.min_order_value} required for this code` });
  }

  let discount = 0;
  if (promo.discount_type === 'flat') {
    discount = promo.discount_value;
  } else if (promo.discount_type === 'percent') {
    discount = Math.round((order_total * promo.discount_value) / 100);
  }

  res.json({
    code: promo.code,
    discount,
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    message: `₹${discount} discount applied!`
  });
});

// ── EXPORT CUSTOMERS CSV ──────────────────────────────

router.get('/export/customers', adminMiddleware, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.phone, u.name, u.address, u.referral_code, u.created_at,
           COUNT(o.id) as order_count,
           COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.role = 'customer'
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();

  const csv = [
    'Phone,Name,Address,Referral Code,Orders,Total Spent,Joined',
    ...users.map(u => `${u.phone},"${u.name || ''}","${u.address || ''}",${u.referral_code || ''},${u.order_count},${u.total_spent},${u.created_at}`)
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=meecart-customers.csv');
  res.send(csv);
});

// ── APP CONTACT SETTINGS ──────────────────────────────

router.get('/app-settings', adminMiddleware, (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT key, value FROM settings WHERE key LIKE "app_%"').all();
  const result = {};
  settings.forEach(s => result[s.key] = s.value);
  res.json(result);
});

module.exports = router;
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
    SELECT u.id, u.phone, u.name, u.address, u.role, u.created_at,
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

// POST /api/admin/categories
router.post('/categories', adminMiddleware, (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });

  const db = getDb();
  const result = db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)').run(name, icon || '🥦');
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(category);
});

// PUT /api/admin/categories/:id
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

// DELETE /api/admin/categories/:id
router.delete('/categories/:id', adminMiddleware, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE products SET active = 0 WHERE category_id = ?').run(req.params.id);
  res.json({ message: 'Category deleted' });
});

// ── SETTINGS ──────────────────────────────────────────

// GET /api/admin/settings
router.get('/settings', adminMiddleware, (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  settings.forEach(s => result[s.key] = s.value);
  res.json(result);
});

// PUT /api/admin/settings
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

// GET /api/admin/banners
router.get('/banners', adminMiddleware, (req, res) => {
  const db = getDb();
  const banners = db.prepare('SELECT * FROM banners ORDER BY created_at DESC').all();
  res.json(banners);
});

// POST /api/admin/banners
router.post('/banners', adminMiddleware, (req, res) => {
  const { title, image_url, product_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Banner title required' });

  const db = getDb();
  const result = db.prepare('INSERT INTO banners (title, image_url, product_id) VALUES (?, ?, ?)').run(title, image_url || null, product_id || null);
  const banner = db.prepare('SELECT * FROM banners WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(banner);
});

// DELETE /api/admin/banners/:id
router.delete('/banners/:id', adminMiddleware, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  res.json({ message: 'Banner deleted' });
});

module.exports = router;
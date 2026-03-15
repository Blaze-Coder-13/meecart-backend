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
      SELECT o.id, o.status, o.total, o.created_at, u.phone, u.name as customer_name
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

module.exports = router;

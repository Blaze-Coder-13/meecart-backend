const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/admin/users
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;

    const result = await query(`
      SELECT u.id, u.phone, u.name, u.address, u.role, u.referral_code, u.referred_by, u.created_at,
             COUNT(o.id) as order_count,
             COALESCE(SUM(o.total), 0) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.role = 'customer'
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countResult = await query("SELECT COUNT(*) as c FROM users WHERE role = 'customer'");
    res.json({ users: result.rows, total: parseInt(countResult.rows[0].c) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/dashboard
router.get('/dashboard', adminMiddleware, async (req, res) => {
  try {
    const [
      total_orders,
      pending_orders,
      active_orders,
      delivered_today,
      revenue_today,
      revenue_total,
      total_customers,
      total_products,
      recent_orders,
      top_products,
    ] = await Promise.all([
      query('SELECT COUNT(*) as c FROM orders'),
      query("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'"),
      query("SELECT COUNT(*) as c FROM orders WHERE status IN ('confirmed','packing','out_for_delivery')"),
      query("SELECT COUNT(*) as c FROM orders WHERE status='delivered' AND DATE(updated_at)=CURRENT_DATE"),
      query("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='delivered' AND DATE(updated_at)=CURRENT_DATE"),
      query("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='delivered'"),
      query("SELECT COUNT(*) as c FROM users WHERE role='customer'"),
      query('SELECT COUNT(*) as c FROM products WHERE active=1'),
      query(`SELECT o.id, o.status, o.total, o.created_at, u.phone, u.name as customer_name
             FROM orders o JOIN users u ON o.user_id = u.id
             ORDER BY o.created_at DESC LIMIT 10`),
      query(`SELECT p.name, p.image_emoji, SUM(oi.quantity) as total_sold
             FROM order_items oi JOIN products p ON oi.product_id = p.id
             GROUP BY p.id, p.name, p.image_emoji ORDER BY total_sold DESC LIMIT 5`),
    ]);

    res.json({
      total_orders: parseInt(total_orders.rows[0].c),
      pending_orders: parseInt(pending_orders.rows[0].c),
      active_orders: parseInt(active_orders.rows[0].c),
      delivered_today: parseInt(delivered_today.rows[0].c),
      revenue_today: parseFloat(revenue_today.rows[0].s),
      revenue_total: parseFloat(revenue_total.rows[0].s),
      total_customers: parseInt(total_customers.rows[0].c),
      total_products: parseInt(total_products.rows[0].c),
      recent_orders: recent_orders.rows,
      top_products: top_products.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── CATEGORIES ────────────────────────────────────────

router.get('/categories/all', adminMiddleware, async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
      GROUP BY c.id ORDER BY c.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/categories', adminMiddleware, async (req, res) => {
  const { name, icon, image_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });
  try {
    const result = await query(
      'INSERT INTO categories (name, icon, image_url) VALUES ($1, $2, $3) RETURNING *',
      [name, icon || '🥦', image_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/categories/:id', adminMiddleware, async (req, res) => {
  const { name, icon, active, image_url } = req.body;
  try {
    await query(`
      UPDATE categories SET
        name = COALESCE($1, name),
        icon = COALESCE($2, icon),
        active = COALESCE($3, active),
        image_url = COALESCE($4, image_url)
      WHERE id = $5
    `, [name || null, icon || null, active !== undefined ? active : null, image_url || null, req.params.id]);
    const result = await query('SELECT * FROM categories WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/categories/:id', adminMiddleware, async (req, res) => {
  try {
    await query('UPDATE products SET active = 0 WHERE category_id = $1', [req.params.id]);
    await query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ message: 'Category deleted' });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── SETTINGS ──────────────────────────────────────────

router.get('/settings', adminMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(s => settings[s.key] = s.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings', adminMiddleware, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [key, String(value)]
      );
    }
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── BANNERS ───────────────────────────────────────────

router.get('/banners', adminMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM banners ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/banners/public', async (req, res) => {
  try {
    const result = await query('SELECT * FROM banners WHERE active = 1 ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/banners', adminMiddleware, async (req, res) => {
  const { title, image_url, product_id } = req.body;
  try {
    const result = await query(
      'INSERT INTO banners (title, image_url, product_id) VALUES ($1, $2, $3) RETURNING *',
      [title || null, image_url || null, product_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/banners/:id', adminMiddleware, async (req, res) => {
  const { active } = req.body;
  try {
    await query('UPDATE banners SET active = $1 WHERE id = $2', [active, req.params.id]);
    res.json({ message: 'Banner updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/banners/:id', adminMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM banners WHERE id = $1', [req.params.id]);
    res.json({ message: 'Banner deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PROMO CODES ───────────────────────────────────────

router.get('/promos', adminMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM promo_codes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/promos', adminMiddleware, async (req, res) => {
  const { code, discount_type, discount_value, min_order_value, max_uses, expires_at } = req.body;
  if (!code || !discount_value) {
    return res.status(400).json({ error: 'Code and discount value required' });
  }
  try {
    const existing = await query('SELECT id FROM promo_codes WHERE code = $1', [code.toUpperCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Promo code already exists' });
    }
    const result = await query(`
      INSERT INTO promo_codes (code, discount_type, discount_value, min_order_value, max_uses, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [code.toUpperCase(), discount_type || 'flat', Number(discount_value),
        Number(min_order_value) || 0, Number(max_uses) || 100, expires_at || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/promos/:id', adminMiddleware, async (req, res) => {
  const { active } = req.body;
  try {
    await query('UPDATE promo_codes SET active = $1 WHERE id = $2', [active, req.params.id]);
    res.json({ message: 'Promo updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/promos/:id', adminMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM promo_codes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Promo deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/promos/apply', async (req, res) => {
  const { code, order_total } = req.body;
  if (!code) return res.status(400).json({ error: 'Promo code required' });
  try {
    const result = await query(`
      SELECT * FROM promo_codes
      WHERE code = $1 AND active = 1
      AND (expires_at IS NULL OR expires_at > NOW())
      AND used_count < max_uses
    `, [code.toUpperCase()]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired promo code' });
    }

    const promo = result.rows[0];
    if (order_total < promo.min_order_value) {
      return res.status(400).json({ error: `Minimum order ₹${promo.min_order_value} required` });
    }

    let discount = 0;
    if (promo.discount_type === 'flat') {
      discount = promo.discount_value;
    } else {
      discount = Math.round((order_total * promo.discount_value) / 100);
    }

    res.json({ code: promo.code, discount, message: `₹${discount} discount applied!` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── EXPORT CSV ────────────────────────────────────────

router.get('/export/customers', adminMiddleware, async (req, res) => {
  try {
    const result = await query(`
      SELECT u.phone, u.name, u.address, u.referral_code, u.referred_by, u.created_at,
             COUNT(o.id) as order_count,
             COALESCE(SUM(o.total), 0) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.role = 'customer'
      GROUP BY u.id ORDER BY u.created_at DESC
    `);

    const csv = [
      'Phone,Name,Address,Referral Code,Referred By,Orders,Total Spent,Joined',
      ...result.rows.map(u =>
        `${u.phone},"${u.name || ''}","${u.address || ''}",${u.referral_code || ''},${u.referred_by || ''},${u.order_count},${u.total_spent},${u.created_at}`
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=meecart-customers.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── FLASH DEALS ───────────────────────────────────────

router.get('/flash-deals', adminMiddleware, async (req, res) => {
  try {
    const result = await query(`
            SELECT fd.*, p.name as product_name, p.image_emoji, p.image_url, p.price as original_price, p.unit as original_unit
      FROM flash_deals fd
      JOIN products p ON fd.product_id = p.id
      ORDER BY fd.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/flash-deals', adminMiddleware, async (req, res) => {
  const { product_id, deal_price, deal_quantity, deal_unit, max_per_order, days } = req.body;
  if (!product_id || !deal_price || !days) {
    return res.status(400).json({ error: 'Product, price and days required' });
  }
  try {
    const expiresAt = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();
    const result = await query(`
      INSERT INTO flash_deals (product_id, deal_price, deal_quantity, deal_unit, max_per_order, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [product_id, deal_price, deal_quantity || 1, deal_unit || 'kg', max_per_order || 1, expiresAt]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/flash-deals/:id', adminMiddleware, async (req, res) => {
  const { active } = req.body;
  try {
    await query('UPDATE flash_deals SET active = $1 WHERE id = $2', [active, req.params.id]);
    res.json({ message: 'Flash deal updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/flash-deals/:id', adminMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM flash_deals WHERE id = $1', [req.params.id]);
    res.json({ message: 'Flash deal deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Public flash deals for app
router.get('/flash-deals/public', async (req, res) => {
  try {
    const result = await query(`
            SELECT fd.*, p.name as product_name, p.image_emoji, p.image_url, p.price as original_price, p.unit as original_unit
      FROM flash_deals fd
      JOIN products p ON fd.product_id = p.id
      WHERE fd.active = 1 AND fd.expires_at > NOW()
      ORDER BY fd.expires_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
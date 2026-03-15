const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// POST /api/orders - place order
router.post('/', authMiddleware, (req, res) => {
  const { items, address, notes } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must have at least one item' });
  }

  if (!address || address.trim().length < 10) {
    return res.status(400).json({ error: 'Valid delivery address required (min 10 chars)' });
  }

  const db = getDb();

  // Validate products and compute total
  let total = 0;
  const validatedItems = [];

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
    if (!product) {
      return res.status(400).json({ error: `Product ID ${item.product_id} not found` });
    }
    if (!item.quantity || item.quantity <= 0) {
      return res.status(400).json({ error: `Invalid quantity for ${product.name}` });
    }

    const lineTotal = product.price * item.quantity;
    total += lineTotal;
    validatedItems.push({ product, quantity: item.quantity, price: product.price, lineTotal });
  }

  // Create order in a transaction
  const createOrder = db.transaction(() => {
    const orderResult = db.prepare(`
      INSERT INTO orders (user_id, total, address, notes, payment_method, status)
      VALUES (?, ?, ?, ?, 'cod', 'pending')
    `).run(req.user.id, total, address.trim(), notes || null);

    const orderId = orderResult.lastInsertRowid;

    for (const item of validatedItems) {
      db.prepare(`
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?)
      `).run(orderId, item.product.id, item.quantity, item.price);
    }

    return orderId;
  });

  const orderId = createOrder();
  const order = getOrderWithItems(db, orderId);

  res.status(201).json({ message: 'Order placed successfully', order });
});

// GET /api/orders/my - customer's orders
router.get('/my', authMiddleware, (req, res) => {
  const db = getDb();
  const orders = db.prepare(`
    SELECT o.*, COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.user_id = ?
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `).all(req.user.id);

  res.json(orders);
});

// GET /api/orders/my/:id - specific order with items
router.get('/my/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  res.json(getOrderWithItems(db, order.id));
});

// ---- Admin routes ----

// GET /api/orders - all orders (admin)
router.get('/', adminMiddleware, (req, res) => {
  const db = getDb();
  const { status, page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = `
    SELECT o.*, u.phone, u.name as customer_name, COUNT(oi.id) as item_count
    FROM orders o
    JOIN users u ON o.user_id = u.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
  `;
  const params = [];

  if (status) {
    query += ' WHERE o.status = ?';
    params.push(status);
  }

  query += ' GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const orders = db.prepare(query).all(...params);

  const total = db.prepare(`SELECT COUNT(*) as c FROM orders ${status ? 'WHERE status = ?' : ''}`).get(...(status ? [status] : [])).c;

  res.json({ orders, total, page: Number(page), pages: Math.ceil(total / limit) });
});

// GET /api/orders/:id (admin)
router.get('/:id', adminMiddleware, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(getOrderWithItems(db, order.id));
});

// PUT /api/orders/:id/status (admin)
router.put('/:id/status', adminMiddleware, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'packing', 'out_for_delivery', 'delivered', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status', valid: validStatuses });
  }

  const db = getDb();

  // If delivered, mark payment as received (COD)
  const paymentStatus = status === 'delivered' ? 'paid' : undefined;

  let query = 'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP';
  const params = [status];

  if (paymentStatus) {
    query += ', payment_status = ?';
    params.push(paymentStatus);
  }

  query += ' WHERE id = ?';
  params.push(req.params.id);

  db.prepare(query).run(...params);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  res.json(order);
});

// GET /api/orders/admin/stats (admin)
router.get('/admin/stats', adminMiddleware, (req, res) => {
  const db = getDb();

  const stats = {
    total_orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    pending: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c,
    confirmed: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'confirmed'").get().c,
    out_for_delivery: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'out_for_delivery'").get().c,
    delivered: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'delivered'").get().c,
    cancelled: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'cancelled'").get().c,
    total_revenue: db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status = 'delivered'").get().s,
    today_orders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')").get().c,
  };

  res.json(stats);
});

// Helper: get full order with items
function getOrderWithItems(db, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = db.prepare(`
    SELECT oi.*, p.name, p.image_emoji, p.unit
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(orderId);
  return { ...order, items };
}

module.exports = router;

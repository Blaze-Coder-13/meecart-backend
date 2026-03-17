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

  // Get settings
  const settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(s => settings[s.key] = s.value);
  const FREE_DELIVERY_ABOVE = Number(settings.free_delivery_above || 150);
  const DELIVERY_CHARGE = Number(settings.delivery_charges || 30);

  // Validate products and compute total
  let subtotal = 0;
  const validatedItems = [];

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
    if (!product) {
      return res.status(400).json({ error: `One or more products in your cart are no longer available. Please refresh and try again.` });
    }
    if (!product.active) {
      return res.status(400).json({ error: `"${product.name}" is currently not available. Please remove it from your cart and try again.` });
    }
    if (!item.quantity || item.quantity <= 0) {
      return res.status(400).json({ error: `Invalid quantity for ${product.name}` });
    }

    const lineTotal = product.price * item.quantity;
    subtotal += lineTotal;
    validatedItems.push({ product, quantity: item.quantity, price: product.price, lineTotal });
  }

  const deliveryCharges = subtotal >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_CHARGE;
  const total = subtotal + deliveryCharges;

  // Create order in a transaction
  const createOrder = db.transaction(() => {
    const orderResult = db.prepare(`
      INSERT INTO orders (user_id, subtotal, delivery_charges, discount, total, address, notes, payment_method, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'cod', 'pending')
    `).run(req.user.id, subtotal, deliveryCharges, 0, total, address.trim(), notes || null);

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
    SELECT o.*, COUNT(oi.id) as item_count,
           o.subtotal, o.delivery_charges, o.discount
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
    SELECT o.*, u.phone, u.name as customer_name, u.address as customer_address,
           COUNT(oi.id) as item_count
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
  const order = db.prepare(`
    SELECT o.*, u.phone, u.name as customer_name, u.address as customer_address
    FROM orders o
    JOIN users u ON o.user_id = u.id
    WHERE o.id = ?
  `).get(req.params.id);
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

// Helper: get full order with items
function getOrderWithItems(db, orderId) {
  const order = db.prepare(`
    SELECT o.*, u.phone, u.name as customer_name, u.address as customer_address
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = ?
  `).get(orderId);

  const items = db.prepare(`
    SELECT oi.*, oi.product_id, p.name, p.image_emoji, p.unit
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(orderId);

  return { ...order, items };
}

module.exports = router;
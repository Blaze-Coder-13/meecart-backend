const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { sendPushToUser, sendPushToAdmins } = require('../utils/notify');

// POST /api/orders
router.post('/', authMiddleware, async (req, res) => {
  const { items, address, notes, promo_code } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must have at least one item' });
  }

  if (!address || address.trim().length < 10) {
    return res.status(400).json({ error: 'Valid delivery address required' });
  }

  try {
    // Get settings
    const settingsResult = await query('SELECT key, value FROM settings');
    const settings = {};
    settingsResult.rows.forEach(s => settings[s.key] = s.value);
    const FREE_DELIVERY_ABOVE = Number(settings.free_delivery_above || 150);
    const DELIVERY_CHARGE = Number(settings.delivery_charges || 30);

    // Validate products
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const productResult = await query('SELECT * FROM products WHERE id = $1', [item.product_id]);
      if (productResult.rows.length === 0) {
        return res.status(400).json({ error: 'One or more products are no longer available.' });
      }
      const product = productResult.rows[0];
      if (!product.active) {
        return res.status(400).json({ error: `"${product.name}" is currently not available. Please remove it from your cart.` });
      }
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ error: `Invalid quantity for ${product.name}` });
      }
      subtotal += product.price * item.quantity;
      validatedItems.push({ product, quantity: item.quantity, price: product.price });
    }

    // Apply referral discount on first order
    let referralDiscount = 0;
    const orderCount = await query('SELECT COUNT(*) as c FROM orders WHERE user_id = $1', [req.user.id]);
    if (parseInt(orderCount.rows[0].c) === 0 && req.user.referred_by) {
      const referralDiscountSetting = await query("SELECT value FROM settings WHERE key = 'referral_discount'");
      referralDiscount = Number(referralDiscountSetting.rows[0]?.value || 30);

      // Also give discount to referrer on their next order
      const referrer = await query('SELECT id FROM users WHERE referral_code = $1', [req.user.referred_by]);
      if (referrer.rows.length > 0) {
        await query(`
          INSERT INTO promo_codes (code, discount_type, discount_value, min_order_value, max_uses, active)
          VALUES ($1, 'flat', $2, 0, 1, 1)
          ON CONFLICT (code) DO NOTHING
        `, [`REF_${referrer.rows[0].id}_${Date.now()}`, referralDiscount]);
      }
    }

    // Apply promo code
    let discount = referralDiscount;
    if (promo_code) {
      const promoResult = await query(`
        SELECT * FROM promo_codes
        WHERE code = $1 AND active = 1
        AND (expires_at IS NULL OR expires_at > NOW())
        AND used_count < max_uses
      `, [promo_code.toUpperCase()]);

      if (promoResult.rows.length > 0) {
        const promo = promoResult.rows[0];
        if (subtotal >= promo.min_order_value) {
          if (promo.discount_type === 'flat') {
            discount = promo.discount_value;
          } else {
            discount = Math.round((subtotal * promo.discount_value) / 100);
          }
          await query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1', [promo.id]);
        }
      }
    }

    const deliveryCharges = subtotal >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_CHARGE;
    const total = subtotal + deliveryCharges - discount;

    // Create order
    const orderResult = await query(`
      INSERT INTO orders (user_id, subtotal, delivery_charges, discount, total, address, notes, payment_method, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'cod', 'pending') RETURNING *
    `, [req.user.id, subtotal, deliveryCharges, discount, total, address.trim(), notes || null]);

    const orderId = orderResult.rows[0].id;

    for (const item of validatedItems) {
      await query(`
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES ($1, $2, $3, $4)
      `, [orderId, item.product.id, item.quantity, item.price]);
    }

    const order = await getOrderWithItems(orderId);

    // Notify admin of new order
    sendPushToAdmins(
      '🛒 New Order!',
      `New order of ₹${total} received from ${req.user.phone}`
    );

    res.status(201).json({ message: 'Order placed successfully', order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/orders/my
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const result = await query(`
      SELECT o.*, COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/orders/my/:id
router.get('/my/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    const order = await getOrderWithItems(req.params.id);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/orders (admin)
router.get('/', adminMiddleware, async (req, res) => {
  try {
    const { status, page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;
    const params = [];

    let text = `
      SELECT o.*, u.phone, u.name as customer_name, u.address as customer_address,
             COUNT(oi.id) as item_count
      FROM orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
    `;

    if (status) {
      params.push(status);
      text += ` WHERE o.status = $${params.length}`;
    }

    text += ` GROUP BY o.id, u.phone, u.name, u.address ORDER BY o.created_at DESC`;
    params.push(limit, offset);
    text += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await query(text, params);
    const countResult = await query(`SELECT COUNT(*) as c FROM orders ${status ? 'WHERE status = $1' : ''}`, status ? [status] : []);

    res.json({
      orders: result.rows,
      total: parseInt(countResult.rows[0].c),
      page: Number(page),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/orders/:id (admin)
router.get('/:id', adminMiddleware, async (req, res) => {
  try {
    const order = await getOrderWithItems(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/orders/:id/status (admin)
router.put('/:id/status', adminMiddleware, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'packing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    let text = 'UPDATE orders SET status = $1, updated_at = NOW()';
    const params = [status];

    if (status === 'delivered') {
      text += ', payment_status = $2 WHERE id = $3';
      params.push('paid', req.params.id);
    } else {
      text += ' WHERE id = $2';
      params.push(req.params.id);
    }

    await query(text, params);
    const result = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const updatedOrder = result.rows[0];

    // Notify customer of status change
    const statusMessages = {
      confirmed: '✅ Your order has been confirmed!',
      packing: '📦 Your order is being packed!',
      out_for_delivery: '🛵 Your order is out for delivery!',
      delivered: '🎉 Your order has been delivered! Pay on delivery.',
      cancelled: '❌ Your order has been cancelled.',
    };

    if (statusMessages[status]) {
      sendPushToUser(
        updatedOrder.user_id,
        'Meecart Order Update',
        statusMessages[status]
      );
    }

    res.json(updatedOrder);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

async function getOrderWithItems(orderId) {
  const orderResult = await query(`
    SELECT o.*, u.phone, u.name as customer_name, u.address as customer_address
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = $1
  `, [orderId]);

  if (orderResult.rows.length === 0) return null;

  const itemsResult = await query(`
    SELECT oi.*, oi.product_id, p.name, p.image_emoji, p.image_url, p.unit
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = $1
  `, [orderId]);

  return { ...orderResult.rows[0], items: itemsResult.rows };
}

module.exports = router;
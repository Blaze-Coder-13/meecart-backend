const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    let text = `
      SELECT p.*, c.name as category_name, c.icon as category_icon
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1 AND (c.active = 1 OR c.active IS NULL)
    `;
    const params = [];

    if (category) {
      params.push(category);
      text += ` AND p.category_id = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      text += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }

    text += ' ORDER BY c.name, p.name';
    const result = await query(text, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/products/categories
router.get('/categories', async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
      WHERE c.active = 1 OR c.active IS NULL
      GROUP BY c.id
      ORDER BY c.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = $1 AND p.active = 1
    `, [req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/products (admin)
router.post('/', adminMiddleware, async (req, res) => {
  const { name, description, price, unit, stock, category_id, image_emoji, image_url } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }
  try {
    const result = await query(`
      INSERT INTO products (name, description, price, unit, stock, category_id, image_emoji, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `, [name, description, price, unit || 'kg', stock || 100, category_id, image_emoji || '🥦', image_url || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/products/:id (admin)
router.put('/:id', adminMiddleware, async (req, res) => {
  const { name, description, price, unit, stock, category_id, image_emoji, image_url, active } = req.body;
  try {
    await query(`
      UPDATE products SET name=$1, description=$2, price=$3, unit=$4,
      stock=$5, category_id=$6, image_emoji=$7, active=$8, image_url=$9 WHERE id=$10
    `, [name, description, price, unit, stock, category_id, image_emoji,
        active !== undefined ? active : 1, image_url || null, req.params.id]);
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/products/:id (admin)
router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    await query('UPDATE products SET active = 0 WHERE id = $1', [req.params.id]);
    res.json({ message: 'Product deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
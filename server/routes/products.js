const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/products - list all active products
router.get('/', (req, res) => {
  const db = getDb();
  const { category, search } = req.query;

  let query = `
    SELECT p.*, c.name as category_name, c.icon as category_icon
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.active = 1 AND (c.active = 1 OR c.active IS NULL)
  `;
  const params = [];

  if (category) {
    query += ' AND p.category_id = ?';
    params.push(category);
  }

  if (search) {
    query += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY c.name, p.name';
  const products = db.prepare(query).all(...params);
  res.json(products);
});

// GET /api/products/categories
router.get('/categories', (req, res) => {
  const db = getDb();
  const categories = db.prepare(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
    WHERE c.active = 1 OR c.active IS NULL
    GROUP BY c.id
    ORDER BY c.name
  `).all();
  res.json(categories);
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ? AND p.active = 1
  `).get(req.params.id);

  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// ---- Admin routes ----

// POST /api/products (admin)
router.post('/', adminMiddleware, (req, res) => {
  const { name, description, price, unit, stock, category_id, image_emoji } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO products (name, description, price, unit, stock, category_id, image_emoji)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, description, price, unit || 'kg', stock || 100, category_id, image_emoji || '🥦');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(product);
});

// PUT /api/products/:id (admin)
router.put('/:id', adminMiddleware, (req, res) => {
  const { name, description, price, unit, stock, category_id, image_emoji, active } = req.body;
  const db = getDb();
  db.prepare(`
    UPDATE products SET name=?, description=?, price=?, unit=?, stock=?, category_id=?, image_emoji=?, active=?
    WHERE id=?
  `).run(name, description, price, unit, stock, category_id, image_emoji, active !== undefined ? active : 1, req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(product);
});

// DELETE /api/products/:id (admin - soft delete)
router.delete('/:id', adminMiddleware, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Product deactivated' });
});

module.exports = router;
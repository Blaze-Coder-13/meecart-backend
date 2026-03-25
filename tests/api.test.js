const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use a test database
process.env.NODE_ENV = 'test';
const DB_PATH = path.join(__dirname, '..', 'meecart_test.db');
process.env.TEST_DB = DB_PATH;

// Override db path for testing
jest.mock('../server/db', () => {
  const Database = require('better-sqlite3');
  const path = require('path');
  const DB_PATH = path.join(__dirname, '..', 'meecart_test.db');
  let db;
  function getDb() {
    if (!db) {
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE NOT NULL, name TEXT, address TEXT, password TEXT, referral_code TEXT, referred_by TEXT, role TEXT DEFAULT 'customer', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, code TEXT NOT NULL, expires_at DATETIME NOT NULL, used INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT DEFAULT '🥦');
        CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, price REAL NOT NULL, unit TEXT DEFAULT 'kg', stock INTEGER DEFAULT 100, category_id INTEGER, image_emoji TEXT DEFAULT '🥦', active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS promo_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, discount_type TEXT DEFAULT 'flat', discount_value REAL NOT NULL, min_order_value REAL DEFAULT 0, max_uses INTEGER DEFAULT 100, used_count INTEGER DEFAULT 0, active INTEGER DEFAULT 1, expires_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS flash_deals (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, deal_price REAL NOT NULL, deal_quantity REAL NOT NULL DEFAULT 1, deal_unit TEXT DEFAULT 'kg', max_per_order INTEGER DEFAULT 1, expires_at DATETIME NOT NULL, active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, status TEXT DEFAULT 'pending', subtotal REAL NOT NULL DEFAULT 0, delivery_charges REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL, address TEXT NOT NULL, notes TEXT, payment_method TEXT DEFAULT 'cod', payment_status TEXT DEFAULT 'pending', referral_reward_granted INTEGER DEFAULT 0, referral_discount_applied INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, unit_snapshot TEXT, is_flash_deal INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS order_status_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      `);
      // Seed test data
      const catExists = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
      if (!catExists) {
        db.prepare("INSERT INTO categories (name, icon) VALUES ('Greens','🥬')").run();
        db.prepare("INSERT INTO products (name, price, unit, stock, category_id, image_emoji) VALUES ('Spinach', 25, '250g', 50, 1, '🥬')").run();
        db.prepare("INSERT INTO users (phone, name, role, referral_code) VALUES ('9999999999', 'Admin', 'admin', 'ADMIN1')").run();
        db.prepare("INSERT INTO settings (key, value) VALUES ('free_delivery_above', '150')").run();
        db.prepare("INSERT INTO settings (key, value) VALUES ('delivery_charges', '30')").run();
        db.prepare("INSERT INTO settings (key, value) VALUES ('referral_discount', '30')").run();
      }
    }
    return db;
  }
  return { getDb };
});

const app = require('../server/index');

let customerToken;
let adminToken;
let testPhone = '9876543210';

describe('Auth API', () => {
  test('POST /api/auth/send-otp - valid phone', async () => {
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: testPhone });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('OTP sent successfully');
  });

  test('POST /api/auth/send-otp - invalid phone', async () => {
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('POST /api/auth/verify-otp - wrong code', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: testPhone, code: '000000' });
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/verify-otp - correct code', async () => {
    // Inject valid OTP directly
    const { getDb } = require('../server/db');
    const db = getDb();
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)').run(testPhone, '123456', expires);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: testPhone, code: '123456', name: 'Test User' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.phone).toBe(testPhone);
    customerToken = res.body.token;
  });

  test('GET /api/auth/me - with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(testPhone);
  });

  test('GET /api/auth/me - without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('Products API', () => {
  test('GET /api/products - returns list', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('GET /api/products/categories - returns categories', async () => {
    const res = await request(app).get('/api/products/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/products?search=spinach - filters correctly', async () => {
    const res = await request(app).get('/api/products?search=spinach');
    expect(res.status).toBe(200);
    expect(res.body.some(p => p.name.toLowerCase().includes('spinach'))).toBe(true);
  });

  test('GET /api/products/:id - returns product', async () => {
    const res = await request(app).get('/api/products/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  test('GET /api/products/999 - not found', async () => {
    const res = await request(app).get('/api/products/999');
    expect(res.status).toBe(404);
  });
});

describe('Orders API', () => {
  test('POST /api/orders - without auth', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ items: [{ product_id: 1, quantity: 2 }], address: 'Test address, street, city' });
    expect(res.status).toBe(401);
  });

  test('POST /api/orders - valid order', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [{ product_id: 1, quantity: 2 }],
        address: '123 Test Street, Rayalaseema, AP 518001'
      });
    expect(res.status).toBe(201);
    expect(res.body.order.id).toBeDefined();
    expect(res.body.order.total).toBe(50); // 25 * 2
  });

  test('POST /api/orders - persists checkout discount in saved order totals', async () => {
    const { getDb } = require('../server/db');
    const db = getDb();

    db.prepare("UPDATE settings SET value = '100' WHERE key = 'free_delivery_above'").run();
    db.prepare("UPDATE users SET referred_by = 'ADMIN1' WHERE phone = ?").run(testPhone);

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [{ product_id: 1, quantity: 5 }],
        address: '123 Test Street, Rayalaseema, AP 518001',
        apply_referral_discount: true,
        discount: 30,
        final_total: 95,
      });

    expect(res.status).toBe(201);
    expect(res.body.order.subtotal).toBe(125);
    expect(res.body.order.discount).toBe(30);
    expect(res.body.order.total).toBe(95);

    const listRes = await request(app)
      .get('/api/orders/my')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body[0].discount).toBe(30);
    expect(listRes.body[0].total).toBe(95);
  });

  test('POST /api/orders - short address fails', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ product_id: 1, quantity: 1 }], address: 'short' });
    expect(res.status).toBe(400);
  });

  test('GET /api/orders/my - returns customer orders', async () => {
    const res = await request(app)
      .get('/api/orders/my')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('Admin API', () => {
  beforeAll(async () => {
    // Login as admin
    const { getDb } = require('../server/db');
    const db = getDb();
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)').run('9999999999', '111111', expires);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '9999999999', code: '111111' });
    adminToken = res.body.token;
  });

  test('GET /api/admin/dashboard - admin only', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total_orders).toBeDefined();
  });

  test('GET /api/admin/dashboard - blocked for customer', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  test('PUT /api/orders/:id/status - admin updates status', async () => {
    const res = await request(app)
      .put('/api/orders/1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
  });

  test('POST /api/products - admin adds product', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Brinjal', price: 35, unit: 'kg', category_id: 1, image_emoji: '🍆' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Brinjal');
  });
});

describe('Health Check', () => {
  test('GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

afterAll(() => {
  // Clean up test database
  try { fs.unlinkSync(DB_PATH); } catch {}
});

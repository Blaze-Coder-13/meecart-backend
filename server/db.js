const { Pool } = require('pg');

let pool;

function getDb() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    });
    initSchema();
  }
  return pool;
}

async function query(text, params) {
  const db = getDb();
  const res = await db.query(text, params);
  return res;
}

async function initSchema() {
  const db = getDb();

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      name TEXT,
      address TEXT,
      password TEXT,
      referral_code TEXT,
      referred_by TEXT,
      role TEXT DEFAULT 'customer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT DEFAULT 'signup',
      expires_at TIMESTAMP NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🥦',
      image_url TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      unit TEXT DEFAULT 'kg',
      stock INTEGER DEFAULT 100,
      category_id INTEGER,
      image_emoji TEXT DEFAULT '🥦',
      image_url TEXT,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      subtotal REAL NOT NULL DEFAULT 0,
      delivery_charges REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      address TEXT NOT NULL,
      notes TEXT,
      payment_method TEXT DEFAULT 'cod',
      payment_status TEXT DEFAULT 'pending',
      delivery_date TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS banners (
      id SERIAL PRIMARY KEY,
      title TEXT,
      image_url TEXT,
      product_id INTEGER,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT DEFAULT 'flat',
      discount_value REAL NOT NULL,
      min_order_value REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 100,
      used_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS push_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, token)
    );

    CREATE TABLE IF NOT EXISTS flash_deals (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      deal_price REAL NOT NULL,
      deal_quantity REAL NOT NULL DEFAULT 1,
      deal_unit TEXT DEFAULT 'kg',
      max_per_order INTEGER DEFAULT 1,
      expires_at TIMESTAMP NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await seedData();
}

async function seedData() {
  const db = getDb();

  const catCount = await db.query('SELECT COUNT(*) as c FROM categories');
  if (parseInt(catCount.rows[0].c) > 0) {
    await seedSettings();
    return;
  }

  const categories = [
    ['Leafy Greens', '🥬'],
    ['Root Vegetables', '🥕'],
    ['Gourds & Squash', '🎃'],
    ['Herbs & Spices', '🌿'],
    ['Fruits & Tomatoes', '🍅'],
    ['Beans & Pods', '🫘'],
  ];

  for (const [name, icon] of categories) {
    await db.query('INSERT INTO categories (name, icon) VALUES ($1, $2)', [name, icon]);
  }

  const products = [
    ['Spinach', 'Fresh farm spinach', 25, '250g', 80, 1, '🥬'],
    ['Methi (Fenugreek)', 'Aromatic methi leaves', 15, 'bunch', 60, 1, '🌿'],
    ['Palak', 'Tender palak leaves', 20, 'bunch', 70, 1, '🥬'],
    ['Carrots', 'Crunchy orange carrots', 40, 'kg', 90, 2, '🥕'],
    ['Beetroot', 'Sweet red beetroot', 35, 'kg', 50, 2, '🫚'],
    ['Radish', 'White mooli radish', 25, 'kg', 40, 2, '⬜'],
    ['Potato', 'Farm fresh potatoes', 30, 'kg', 200, 2, '🥔'],
    ['Onion', 'Red onions', 45, 'kg', 150, 2, '🧅'],
    ['Bitter Gourd', 'Karela, fresh & tender', 40, 'kg', 30, 3, '🟢'],
    ['Ridge Gourd', 'Turai, young pods', 30, 'kg', 35, 3, '🟢'],
    ['Bottle Gourd', 'Lauki, tender', 25, 'kg', 40, 3, '🫙'],
    ['Coriander', 'Fresh hara dhaniya', 10, 'bunch', 100, 4, '🌿'],
    ['Green Chilli', 'Spicy green chillies', 20, '100g', 80, 4, '🌶️'],
    ['Tomato', 'Ripe red tomatoes', 40, 'kg', 120, 5, '🍅'],
    ['Brinjal', 'Purple baingan', 35, 'kg', 60, 5, '🍆'],
    ['Capsicum', 'Green bell pepper', 60, 'kg', 45, 5, '🫑'],
    ['Beans', 'French beans', 50, 'kg', 40, 6, '🫘'],
    ['Peas', 'Fresh green peas', 80, 'kg', 30, 6, '🟢'],
    ['Lady Finger', 'Bhindi, tender', 45, 'kg', 55, 6, '🟩'],
    ['Drumstick', 'Moringa pods', 30, '250g', 25, 6, '🪵'],
  ];

  for (const p of products) {
    await db.query(`
      INSERT INTO products (name, description, price, unit, stock, category_id, image_emoji)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, p);
  }

  const adminExists = await db.query("SELECT id FROM users WHERE phone = '9999999999'");
  if (adminExists.rows.length === 0) {
    await db.query("INSERT INTO users (phone, name, role) VALUES ('9999999999', 'Admin', 'admin')");
  }

  await seedSettings();
  console.log('✅ Database seeded');
}

async function seedSettings() {
  const db = getDb();
  const settingsData = [
    ['min_order_value', '150'],
    ['delivery_charges', '30'],
    ['free_delivery_above', '150'],
    ['delivery_message', 'Add ₹{amount} more for free delivery!'],
    ['delivery_time', '7:00 AM - 12:00 PM'],
    ['delivery_days', 'Monday to Saturday'],
    ['app_contact_email', 'support@meecart.com'],
    ['app_contact_phone', '+91 9999999999'],
    ['app_contact_address', 'Your city, State'],
    ['app_name', 'Meecart'],
    ['referral_discount', '30'],
  ];

  for (const [key, value] of settingsData) {
    await db.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }
}

function generateReferralCode(phone) {
  return 'MC' + phone.slice(-4) + Math.random().toString(36).substring(2, 5).toUpperCase();
}

module.exports = { getDb, generateReferralCode, query };
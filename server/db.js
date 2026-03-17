const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'meecart.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      name TEXT,
      address TEXT,
      password TEXT,
      referral_code TEXT,
      referred_by TEXT,
      role TEXT DEFAULT 'customer',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT DEFAULT 'signup',
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🥦',
      image_url TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      unit TEXT DEFAULT 'kg',
      stock INTEGER DEFAULT 100,
      category_id INTEGER,
      image_emoji TEXT DEFAULT '🥦',
      image_url TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      image_url TEXT,
      product_id INTEGER,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT DEFAULT 'flat',
      discount_value REAL NOT NULL,
      min_order_value REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 100,
      used_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL
    );
  `);

  migrateSchema();
  seedData();
}

function migrateSchema() {
  // Add new columns to existing tables safely
  const migrations = [
    "ALTER TABLE users ADD COLUMN password TEXT",
    "ALTER TABLE users ADD COLUMN referral_code TEXT",
    "ALTER TABLE users ADD COLUMN referred_by TEXT",
    "ALTER TABLE categories ADD COLUMN image_url TEXT",
    "ALTER TABLE categories ADD COLUMN active INTEGER DEFAULT 1",
    "ALTER TABLE products ADD COLUMN image_url TEXT",
    "ALTER TABLE orders ADD COLUMN subtotal REAL DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN delivery_charges REAL DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN discount REAL DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN delivery_date TEXT",
    "ALTER TABLE otp_codes ADD COLUMN purpose TEXT DEFAULT 'signup'",
"ALTER TABLE banners ADD COLUMN title TEXT",
  ];

  for (const sql of migrations) {
    try { db.exec(sql); } catch {}
  }
}

function generateReferralCode(phone) {
  return 'MC' + phone.slice(-4) + Math.random().toString(36).substring(2, 5).toUpperCase();
}

function seedData() {
  const categoryCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (categoryCount > 0) {
    seedSettings();
    return;
  }

  // Seed categories
  const insertCat = db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)');
  const categories = [
    ['Leafy Greens', '🥬'],
    ['Root Vegetables', '🥕'],
    ['Gourds & Squash', '🎃'],
    ['Herbs & Spices', '🌿'],
    ['Fruits & Tomatoes', '🍅'],
    ['Beans & Pods', '🫘'],
  ];
  categories.forEach(c => insertCat.run(...c));

  // Seed products
  const insertProd = db.prepare(`
    INSERT INTO products (name, description, price, unit, stock, category_id, image_emoji)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

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

  products.forEach(p => insertProd.run(...p));

  // Seed admin user
  const adminExists = db.prepare("SELECT id FROM users WHERE phone = '9999999999'").get();
  if (!adminExists) {
    db.prepare("INSERT INTO users (phone, name, role) VALUES ('9999999999', 'Admin', 'admin')").run();
  }

  seedSettings();
  console.log('✅ Database seeded');
}

function seedSettings() {
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
  ];

  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  settingsData.forEach(s => insert.run(...s));
}

module.exports = { getDb, generateReferralCode };
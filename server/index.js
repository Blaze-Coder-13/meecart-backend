const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));

// Public settings route
app.get('/api/settings', (req, res) => {
  const { getDb } = require('./db');
  const db = getDb();
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  settings.forEach(s => result[s.key] = s.value);
  res.json(result);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), app: 'Meecart' });
});

// Fallback for SPA routes
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only start server if not in test mode
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🛒 Meecart server running at http://localhost:${PORT}`);
    console.log(`📱 Customer app:  http://localhost:${PORT}`);
    console.log(`🛠️  Admin panel:   http://localhost:${PORT}/admin`);
    console.log(`\n💡 Admin login: phone 9999999999\n`);
  });
}

module.exports = app;
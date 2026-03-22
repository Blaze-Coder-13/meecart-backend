const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));

// Public settings route
app.get('/api/settings', async (req, res) => {
  try {
    const { query } = require('./db');
    const result = await query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(s => settings[s.key] = s.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), app: 'Meecart' });
});

app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🛒 Meecart server running at http://localhost:${PORT}`);
    console.log(`📱 Customer app:  http://localhost:${PORT}`);
    console.log(`🛠️  Admin panel:   http://localhost:${PORT}/admin\n`);
  });
}

module.exports = app;

# 🛒 Meecart — Backend Server

A full-stack vegetable delivery app with:
- 📱 Phone + OTP login (no passwords)
- 🛒 Customer shopping UI
- 📦 Admin dashboard for managing orders & products
- 💵 Cash on Delivery payment
- 🗃️ SQLite database (zero setup, runs anywhere)

---

## ⚡ Quick Start

### Prerequisites
- Node.js 18+ (https://nodejs.org)
- npm (comes with Node)

### 1. Install dependencies
```bash
cd meecart
npm install
```

### 2. Start the server
```bash
npm start
```

### 3. Open in browser
| URL | Purpose |
|-----|---------|
| http://localhost:3000 | Customer app |
| http://localhost:3000/login.html | Login page |
| http://localhost:3000/admin | Admin panel |

---

## 🔑 Login Guide

### Customer Login
1. Go to http://localhost:3000/login.html
2. Enter any 10-digit mobile number
3. **OTP is printed in the terminal** (console) — copy and paste it
4. You're logged in!

### Admin Login
- Phone: `9999999999`
- OTP: **check terminal output** after clicking Send OTP

---

## 🧪 Run Tests
```bash
npm test
```
Runs 20+ tests covering auth, products, orders, and admin APIs.

---

## 📁 Project Structure

```
meecart/
├── server/
│   ├── index.js          # Express app entry point
│   ├── db.js             # SQLite database + schema + seed data
│   ├── routes/
│   │   ├── auth.js       # OTP login, profile
│   │   ├── products.js   # Product listing, CRUD
│   │   ├── orders.js     # Place order, track, admin manage
│   │   └── admin.js      # Dashboard stats, customer list
│   └── middleware/
│       └── auth.js       # JWT middleware
├── public/
│   ├── index.html        # Customer shop page
│   ├── login.html        # OTP login
│   └── orders.html       # Order tracking
├── admin/
│   └── index.html        # Admin dashboard
├── tests/
│   └── api.test.js       # Jest + Supertest tests
├── meecart.db            # Auto-created SQLite database
├── package.json
└── README.md
```

---

## 🌐 API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/send-otp` | Send OTP to phone |
| POST | `/api/auth/verify-otp` | Verify OTP, get JWT token |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/profile` | Update name & address |

### Products (Public)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List all products (supports `?search=` `?category=`) |
| GET | `/api/products/categories` | List categories |
| GET | `/api/products/:id` | Single product |

### Orders
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/orders` | Customer | Place order (COD) |
| GET | `/api/orders/my` | Customer | My orders |
| GET | `/api/orders/my/:id` | Customer | Order details |
| GET | `/api/orders` | Admin | All orders |
| PUT | `/api/orders/:id/status` | Admin | Update order status |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard` | Stats + recent orders |
| GET | `/api/admin/users` | All customers |
| POST | `/api/products` | Add product |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Deactivate product |

---

## 🚀 Deployment

### VPS / Any Linux Server
```bash
# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone or upload project
cd meecart
npm install --production

# Run with PM2 (keeps running in background)
npm install -g pm2
pm2 start server/index.js --name meecart
pm2 save && pm2 startup
```

### Environment Variables (Production)
Create a `.env` file or set these:
```env
PORT=3000
JWT_SECRET=your-very-long-random-secret-key-here
```

### Add Real SMS (Twilio)
In `server/routes/auth.js`, replace the `sendSMS` function:
```js
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

async function sendSMS(phone, code) {
  await client.messages.create({
    to: `+91${phone}`,
    from: process.env.TWILIO_FROM,
    body: `Your Meecart OTP: ${code}. Valid for 5 minutes.`
  });
}
```

---

## 📦 Seeded Products

The database comes pre-seeded with 20 vegetables across 6 categories:
- 🥬 Leafy Greens (Spinach, Methi, Palak)
- 🥕 Root Vegetables (Carrots, Beetroot, Potato, Onion)
- 🎃 Gourds & Squash (Bitter Gourd, Ridge Gourd, Bottle Gourd)
- 🌿 Herbs & Spices (Coriander, Green Chilli)
- 🍅 Fruits & Tomatoes (Tomato, Brinjal, Capsicum)
- 🫘 Beans & Pods (Beans, Peas, Lady Finger, Drumstick)

---

## 🔒 Security Notes

1. **Change JWT_SECRET** before going live
2. **Add real SMS provider** (Twilio, MSG91, Fast2SMS)
3. **Use HTTPS** in production (nginx + certbot)
4. **Rate limit** OTP requests in production (add `express-rate-limit`)

---

Built with: Express · SQLite · Vanilla JS · JWT · No build tools required

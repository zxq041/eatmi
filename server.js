/**
 * eatmi.pl — Backend API (Railway, single-folder)
 * ------------------------------------------------
 * Funkcje:
 *  - Zamówienia (+ płatność SANDBOX)
 *  - Boxy do kreatora (creatorBoxes) CRUD
 *  - Gotowe zestawy (readyBoxes) CRUD
 *  - Produkty CRUD
 *  - Pracownicy CRUD + login kodem
 *  - Ustawienia Happy Hour
 *  - Serwowanie statyczne: index.html, panel.html (z tego samego folderu)
 *
 * ENV (Railway → Variables):
 *  - PORT                (automatycznie ustawiane przez Railway)
 *  - MONGODB_URI         (np. Atlas SRV lub Railway Mongo add-on)
 *  - CORS_ORIGIN         (lista dozwolonych originów, np. https://twojadomena.pl,https://twoj-user.github.io)
 *  - SANDBOX_PAYMENTS    (true/false – domyślnie true)
 *  - SEED_KEY            (tajny klucz do /api/dev/seed)
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { nanoid } from 'nanoid';
import Joi from 'joi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- App & Security ----------
const app = express();

// Poluzowane nagłówki pod CDN + Babel (UMD) + obrazy zewnętrzne
app.use(helmet({
  contentSecurityPolicy: false,        // CSP off (Babel UMD używa eval)
  crossOriginEmbedderPolicy: false,    // zewnętrzne zasoby
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' } // zezwól na obrazy/skrypty z CDN
}));

// CORS – whitelist z env (comma-separated), '*' dopuszcza wszystko
app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = (process.env.CORS_ORIGIN || '*')
        .split(',')
        .map((s) => s.trim());
      if (allowed.includes('*') || !origin || allowed.includes(origin)) return cb(null, true);
      return cb(null, false);
    }
  })
);

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

const PORT =
  process.env.PORT ||
  8080;

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGODB_URL ||
  process.env.DATABASE_URL ||
  'mongodb://127.0.0.1:27017/eatmi';

// ---------- DB ----------
mongoose
  .connect(MONGODB_URI, { autoIndex: true })
  .then(() => console.log('[eatmi] MongoDB connected'))
  .catch((e) => {
    console.error('Mongo error:', e);
    // nie zabijamy procesu, żeby Railway nadal serwował frontend;
    // ale API wymagające DB będą zwracać błędy dopóki URI nie będzie poprawne
  });

// ---------- Schemas & Models ----------
const categoryEnum = ['slone', 'slodkie', 'zdrowe', 'napoj'];

const ProductSchema = new mongoose.Schema(
  {
    category: { type: String, enum: categoryEnum, required: true },
    name: { type: String, required: true },
    desc: { type: String, default: '' },
    img:  { type: String, default: '' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const CreatorBoxSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    limits: {
      slone: { type: Number, default: 0, min: 0 },
      slodkie: { type: Number, default: 0, min: 0 },
      zdrowe: { type: Number, default: 0, min: 0 },
      napoj: { type: Number, default: 0, min: 0 }
    },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const ReadyBoxSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        name: String
      }
    ],
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: { type: String, enum: ['owner', 'staff'], default: 'staff' },
    code: { type: String, required: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const SettingsSchema = new mongoose.Schema(
  {
    happyHour: {
      enabled: { type: Boolean, default: true },
      message: { type: String, default: '🎉 Dziś −15% z kodem HAPPY15 do 15:00' }
    }
  },
  { timestamps: true }
);

const OrderSchema = new mongoose.Schema(
  {
    orderNo: { type: String, index: true },
    items: [
      {
        type: { type: String, enum: ['custom-box', 'ready-box'], required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true, min: 0 },
        qty: { type: Number, default: 1, min: 1 },
        products: [
          {
            productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
            name: String
          }
        ]
      }
    ],
    total: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
    payment: {
      provider: { type: String, default: 'SANDBOX' },
      sandboxId: { type: String },
      paidAt: { type: Date }
    },
    customer: {
      imieNazwisko: String,
      telefon: String,
      email: String,
      adres: {
        miasto: String,
        kod: String,
        ulica: String,
        nrBud: String,
        pietro: String,
        lokal: String
      }
    },
    uwagi: String,
    faktura: {
      nip: String,
      firma: String
    }
  },
  { timestamps: true }
);

const Product   = mongoose.model('Product', ProductSchema);
const CreatorBox= mongoose.model('CreatorBox', CreatorBoxSchema);
const ReadyBox  = mongoose.model('ReadyBox', ReadyBoxSchema);
const Employee  = mongoose.model('Employee', EmployeeSchema);
const Settings  = mongoose.model('Settings', SettingsSchema);
const Order     = mongoose.model('Order', OrderSchema);

// ---------- Helpers ----------
const ok   = (res, data) => res.json({ ok: true, data });
const fail = (res, msg = 'Bad Request', code = 400) => res.status(code).json({ ok: false, error: msg });
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { next(e); } };
const ensureSettings = async () => { const c = await Settings.countDocuments(); if (!c) await Settings.create({}); };
const paidBySandbox = () => String(process.env.SANDBOX_PAYMENTS ?? 'true').toLowerCase() === 'true';

// ---------- Health ----------
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ---------- Settings: Happy Hour ----------
app.get('/api/settings/happy-hour', wrap(async (_, res) => {
  await ensureSettings();
  const s = await Settings.findOne();
  ok(res, s.happyHour);
}));

app.put('/api/settings/happy-hour', wrap(async (req, res) => {
  const schema = Joi.object({ enabled: Joi.boolean().required(), message: Joi.string().allow('').required() });
  const { error, value } = schema.validate(req.body);
  if (error) return fail(res, error.message);
  await ensureSettings();
  const s = await Settings.findOne();
  s.happyHour = value;
  await s.save();
  ok(res, s.happyHour);
}));

// ---------- Auth (login kodem) ----------
app.post('/api/auth/login', wrap(async (req, res) => {
  const schema = Joi.object({ code: Joi.string().required() });
  const { error, value } = schema.validate(req.body);
  if (error) return fail(res, error.message);
  const emp = await Employee.findOne({ code: value.code, active: true });
  if (!emp) return fail(res, 'Nieprawidłowy kod lub konto nieaktywne', 401);
  ok(res, { id: emp.id, name: emp.name, role: emp.role });
}));

// ---------- Employees CRUD ----------
app.get('/api/employees', wrap(async (_, res) => ok(res, await Employee.find().sort({ createdAt: -1 })) ));
app.post('/api/employees', wrap(async (req, res) => {
  const schema = Joi.object({ name: Joi.string().required(), role: Joi.string().valid('owner','staff').required(), code: Joi.string().required(), active: Joi.boolean().default(true) });
  const { error, value } = schema.validate(req.body); if (error) return fail(res, error.message);
  ok(res, await Employee.create(value));
}));
app.put('/api/employees/:id', wrap(async (req, res) => {
  const schema = Joi.object({ name: Joi.string(), role: Joi.string().valid('owner','staff'), code: Joi.string(), active: Joi.boolean() });
  const { error, value } = schema.validate(req.body); if (error) return fail(res, error.message);
  const doc = await Employee.findByIdAndUpdate(req.params.id, value, { new: true }); if (!doc) return fail(res, 'Not found', 404);
  ok(res, doc);
}));
app.delete('/api/employees/:id', wrap(async (req, res) => {
  const del = await Employee.findByIdAndDelete(req.params.id); if (!del) return fail(res, 'Not found', 404);
  ok(res, true);
}));

// ---------- Products CRUD ----------
app.get('/api/products', wrap(async (req, res) => {
  const q = req.query.category ? { category: req.query.category } : {};
  ok(res, await Product.find(q).sort({ createdAt: -1 }));
}));
app.get('/api/products/grouped', wrap(async (_, res) => {
  const all = await Product.find({ active: true });
  const grouped = categoryEnum.reduce((acc, c) => { acc[c] = all.filter(p => p.category === c); return acc; }, {});
  ok(res, grouped);
}));
app.post('/api/products', wrap(async (req, res) => {
  const schema = Joi.object({ category: Joi.string().valid(...categoryEnum).required(), name: Joi.string().required(), desc: Joi.string().allow(''), img: Joi.string().allow(''), active: Joi.boolean().default(true) });
  const { error, value } = schema.validate(req.body); if (error) return fail(res, error.message);
  ok(res, await Product.create(value));
}));
app.put('/api/products/:id', wrap(async (req, res) => {
  const schema = Joi.object({ category: Joi.string().valid(...categoryEnum), name: Joi.string(), desc: Joi.string().allow(''), img: Joi.string().allow(''), active: Joi.boolean() });
  const { error, value } = schema.validate(req.body); if (error) return fail(res, error.message);
  const doc = await Product.findByIdAndUpdate(req.params.id, value, { new: true }); if (!doc) return fail(res, 'Not found', 404);
  ok(res, doc);
}));
app.delete('/api/products/:id', wrap(async (req, res) => {
  const del = await Product.findByIdAndDelete(req.params.id); if (!del) return fail(res, 'Not found', 404);
  ok(res, true);
}));

// ---------- Creator Boxes CRUD ----------
app.get('/api/creator-boxes', wrap(async (_, res) => ok(res, await CreatorBox.find().sort({ createdAt: -1 })) ));
app.post('/api/creator-boxes', wrap(async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().required(),
    price: Joi.number().min(0).required(),
    limits: Joi.object({ slone: Joi.number().min(0).default(0), slodkie: Joi.number().min(0).default(0), zdrowe: Joi.number().min(0).default(0), napoj: Joi.number().min(0).default(0) }).required(),
    active: Joi.boolean().default(true)
  });
  const { error, value } = schema.validate(req.body); if (error) return fail(res, error.message);
  ok(res, await CreatorBox.create(value));
}));
app.put('/api/creator-boxes/:id', wrap(async (req, res) => {
  const schema = Joi.object({
    name: Joi.string(),
    price: Joi.number().min(0),
    limits: Joi.object({ slone: Joi.number().min(0), slodkie: Joi.number().min(0), zdrowe: Joi.number().min(0), napoj: Joi.number().min(0) }),
    active: Joi.boolean()
  });
  const { error, value } = schema.validate(req.body); if (error) return fail(res, error.message);
  const doc = await CreatorBox.findByIdAndUpdate(req.params.id, value, { new: true }); if (!doc) return fail(res, 'Not found', 404);
  ok(res, doc);
}));
app.delete('/api/creator-boxes/:id', wrap(async (req, res) => {
  const del = await CreatorBox.findByIdAndDelete(req.params.id); if (!del) return fail(res, 'Not found', 404);
  ok(res, true);
}));

// ---------- Ready Boxes CRUD ----------
app.get('/api/ready-boxes', wrap(async (_, res) => ok(res, await ReadyBox.find().sort({ createdAt: -1 })) ));
app.post('/api/ready-boxes', wrap(async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().required(),
    price: Joi.number().min(0).required(),
    items: Joi.array().items(Joi.object({ productId: Joi.string().optional(), name: Joi.string().optional() })).default([]),
    active: Joi.boolean().default(true)
  });
  const { error, value } = schema.validate(req.body); if (error) return fail(res, error.message);
  ok(res, await ReadyBox.create(value));
}));
app.put('/api/ready-boxes/:id', wrap(async (req, res) => {
  const schema = Joi.object({
    name: Joi.string(),
    price: Joi.number().min(0),
    items: Joi.array().items(Joi.object({ productId: Joi.string().optional(), name: Joi.string().optional() })),
    active: Joi.boolean()
  });
  const { error, value } = schema.validate(req.body); if (error) return fail(res, error.message);
  const doc = await ReadyBox.findByIdAndUpdate(req.params.id, value, { new: true }); if (!doc) return fail(res, 'Not found', 404);
  ok(res, doc);
}));
app.delete('/api/ready-boxes/:id', wrap(async (req, res) => {
  const del = await ReadyBox.findByIdAndDelete(req.params.id); if (!del) return fail(res, 'Not found', 404);
  ok(res, true);
}));

// ---------- Orders ----------
app.get('/api/orders', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const q = {};
  if (req.query.date) {
    const d = new Date(req.query.date);
    if (!isNaN(d)) {
      const start = new Date(d.toISOString().slice(0,10));
      const end = new Date(start); end.setDate(end.getDate() + 1);
      q.createdAt = { $gte: start, $lt: end };
    }
  }
  const [list, total] = await Promise.all([
    Order.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(q)
  ]);
  ok(res, { list, total, page, pages: Math.ceil(total / limit) });
}));

app.get('/api/orders/:id', wrap(async (req, res) => {
  const o = await Order.findById(req.params.id); if (!o) return fail(res, 'Not found', 404);
  ok(res, o);
}));

app.post('/api/orders', wrap(async (req, res) => {
  const schema = Joi.object({
    items: Joi.array().items(
      Joi.object({
        type: Joi.string().valid('custom-box','ready-box').required(),
        name: Joi.string().required(),
        price: Joi.number().min(0).required(),
        qty: Joi.number().min(1).default(1),
        items: Joi.array().items(Joi.object({ id: Joi.string().optional(), name: Joi.string().optional() })).optional()
      })
    ).min(1).required(),
    total: Joi.number().min(0).required(),
    customer: Joi.object({
      imieNazwisko: Joi.string().required(),
      telefon: Joi.string().required(),
      email: Joi.string().allow(''),
      miasto: Joi.string().allow(''),
      kod: Joi.string().allow(''),
      ulica: Joi.string().required(),
      nrBud: Joi.string().allow(''),
      pietro: Joi.string().allow(''),
      lokal: Joi.string().allow('')
    }).required(),
    uwagi: Joi.string().allow(''),
    faktura: Joi.object({ nip: Joi.string().allow(''), firma: Joi.string().allow('') }).optional()
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false });
  if (error) return fail(res, error.message);

  const mappedItems = value.items.map((row) => ({
    type: row.type,
    name: row.name,
    price: row.price,
    qty: row.qty ?? 1,
    products: (row.items || []).map((p) => ({ name: p.name }))
  }));

  const orderNo = `E${new Date().toISOString().slice(2,10).replaceAll('-','')}-${nanoid(6).toUpperCase()}`;
  const paid = paidBySandbox();
  const orderDoc = await Order.create({
    orderNo,
    items: mappedItems,
    total: value.total,
    status: paid ? 'paid' : 'pending',
    payment: paid ? { provider: 'SANDBOX', sandboxId: nanoid(), paidAt: new Date() } : { provider: 'SANDBOX' },
    customer: {
      imieNazwisko: value.customer.imieNazwisko,
      telefon: value.customer.telefon,
      email: value.customer.email,
      adres: {
        miasto: value.customer.miasto,
        kod: value.customer.kod,
        ulica: value.customer.ulica,
        nrBud: value.customer.nrBud,
        pietro: value.customer.pietro,
        lokal: value.customer.lokal
      }
    },
    uwagi: value.uwagi,
    faktura: value.faktura
  });

  ok(res, orderDoc);
}));

// ---------- Payments SANDBOX (opcjonalnie) ----------
app.post('/api/payments/sandbox/intent', wrap(async (req, res) => {
  ok(res, { intentId: nanoid(), provider: 'SANDBOX' });
}));
app.post('/api/payments/sandbox/confirm/:orderId', wrap(async (req, res) => {
  const o = await Order.findById(req.params.orderId); if (!o) return fail(res, 'Not found', 404);
  o.status = 'paid';
  o.payment = { provider: 'SANDBOX', sandboxId: nanoid(), paidAt: new Date() };
  await o.save();
  ok(res, o);
}));

// ---------- Dev seed ----------
app.post('/api/dev/seed', wrap(async (req, res) => {
  if (!process.env.SEED_KEY || req.query.key !== process.env.SEED_KEY) return fail(res, 'Forbidden', 403);
  await ensureSettings();

  const [pC, cC, rC, eC] = await Promise.all([
    Product.countDocuments(),
    CreatorBox.countDocuments(),
    ReadyBox.countDocuments(),
    Employee.countDocuments()
  ]);

  if (!pC) {
    await Product.insertMany([
      { category: 'slone', name: 'Chicken Burger', desc: 'kurczak, miód-muszt.', img: 'https://images.unsplash.com/photo-1606756790138-261d2b21cd75?q=80&w=800&auto=format&fit=crop' },
      { category: 'slone', name: 'Beef Classic', desc: 'wołowina, cheddar', img: 'https://images.unsplash.com/photo-1550317138-10000687a72b?q=80&w=800&auto=format&fit=crop' },
      { category: 'slodkie', name: 'Brownie', desc: 'gęste, czekoladowe', img: 'https://images.unsplash.com/photo-1541782814453-c5f53aa5d3c5?q=80&w=800&auto=format&fit=crop' },
      { category: 'zdrowe', name: 'Sałatka Caesar', desc: 'kurczak, parmezan', img: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?q=80&w=800&auto=format&fit=crop' },
      { category: 'napoj', name: 'Woda 0,5l', desc: 'gaz./niegaz.', img: 'https://images.unsplash.com/photo-1502741338009-cac2772e18bc?q=80&w=800&auto=format&fit=crop' }
    ]);
  }

  if (!cC) {
    await CreatorBox.insertMany([
      { name: 'Box 1', price: 32, limits: { slone: 1, slodkie: 1, zdrowe: 0, napoj: 1 } },
      { name: 'Box 2', price: 39, limits: { slone: 1, slodkie: 1, zdrowe: 1, napoj: 1 } },
      { name: 'Box 3', price: 49, limits: { slone: 2, slodkie: 1, zdrowe: 2, napoj: 1 } }
    ]);
  }

  if (!rC) {
    await ReadyBox.insertMany([
      { name: 'Protein Power', price: 39, items: [{ name: 'Beef Classic' }, { name: 'Sałatka Caesar' }, { name: 'Woda 0,5l' }] },
      { name: 'Sweet&Salty',  price: 35, items: [{ name: 'Chicken Burger' }, { name: 'Brownie' }, { name: 'Lemoniada'   }] }
    ]);
  }

  if (!eC) {
    await Employee.insertMany([
      { name: 'Owner',           role: 'owner', code: '0051' },
      { name: 'Anna – Obsługa',  role: 'staff', code: '1111' }
    ]);
  }

  ok(res, { seeded: true });
}));

// ---------- Static files & SPA routing ----------
// Serwuj WSZYSTKIE pliki z bieżącego folderu (index.html, panel.html, assets...)
app.use(express.static(__dirname));

// /panel → panel.html
app.get('/panel', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel.html'));
});

// Root → index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback dla pozostałych ścieżek (np. gdyby ktoś wszedł w /coś) – SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- Errors ----------
app.use((req, res) => fail(res, 'Not found', 404));
app.use((err, req, res, next) => {
  console.error('ERR:', err);
  fail(res, 'Server error', 500);
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`[eatmi] API on :${PORT}`);
});

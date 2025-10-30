import 'dotenv/config';
import path from 'path';
import fs from 'fs';
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

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eatmi';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('[eatmi] MongoDB connected'))
  .catch(err => console.error('[eatmi] Mongo error:', err?.message || err));

const OrderSchema = new mongoose.Schema({
  name: String,
  total: Number,
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.get('/api/orders', async (_, res) => {
  const list = await Order.find().sort({ createdAt: -1 });
  res.json({ ok: true, data: list });
});

app.post('/api/orders', async (req, res) => {
  const o = await Order.create({ name: req.body.name, total: req.body.total });
  res.json({ ok: true, data: o });
});

app.use(express.static(__dirname));

app.get('/panel', (req, res, next) => {
  const p = path.join(__dirname, 'panel.html');
  if (!fs.existsSync(p)) return res.status(404).send('panel.html not found');
  res.sendFile(p, err => err && next(err));
});

app.get('/', (req, res, next) => {
  const p = path.join(__dirname, 'index.html');
  if (!fs.existsSync(p)) return res.status(404).send('index.html not found');
  res.sendFile(p, err => err && next(err));
});

app.get('*', (req, res, next) => {
  const p = path.join(__dirname, 'index.html');
  res.sendFile(p, err => err && next(err));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ ok: false, error: 'Server error' });
});

app.listen(PORT, () => console.log(`[eatmi] API on :${PORT}`));

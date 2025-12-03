/**
 * server.js — eatmi.pl backend + PayU (ESM, bez axios)
 * -------------------------------------------------
 * DZIAŁA przy "type": "module" w package.json
 *
 * WYMAGANE:
 *   npm i express cors
 *
 * Node >=18 ma wbudowane fetch.
 */

import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { fileURLToPath } from "url";

// żeby mieć __dirname w ESM:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================== CONFIG APP ==================
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ================== PAYU CONFIG ==================
/**
 * 🔥 TU WSTAWIASZ SWOJE DANE PAYU 🔥
 * Najlepiej wrzuć do .env i tu zostaw tylko process.env....
 */

// posId / merchantPosId
const PAYU_POS_ID = process.env.PAYU_POS_ID || "4415769";

// Second key (MD5)
const PAYU_MD5 = process.env.PAYU_MD5 || "580033922fa44e698f99ccb91b225d3b";

// OAuth
const PAYU_CLIENT_ID = process.env.PAYU_CLIENT_ID || "4415769";
const PAYU_CLIENT_SECRET =
  process.env.PAYU_CLIENT_SECRET || "835a154e9fc454e935ad6bb73dafd66c";
//  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//  TU WSTAWIASZ CLIENT SECRET (najlepiej w .env)

// PROD (PL/EU):
const PAYU_BASE = "https://secure.payu.com";
// SANDBOX (jeśli testujesz):
// const PAYU_BASE = "https://secure.snd.payu.com";

// Twoje adresy (zmień na swoje prawdziwe domeny)
const CONTINUE_URL =
  process.env.PAYU_CONTINUE_URL || "https://twojadomena.pl/#/success";
const NOTIFY_URL =
  process.env.PAYU_NOTIFY_URL || "https://twojadomena.pl/api/payu/notify";

// ================== SIMPLE ORDERS STORE ==================
const ORDERS_FILE = path.join(__dirname, "orders.json");

const readOrders = () => {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
  } catch {
    return [];
  }
};

const saveOrders = (orders) =>
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));

// ================== PAYU HELPERS ==================
async function getPayuToken() {
  const tokenUrl = `${PAYU_BASE}/pl/standard/user/oauth/authorize`;

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", PAYU_CLIENT_ID);
  params.append("client_secret", PAYU_CLIENT_SECRET);

  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error("PayU token error: " + errText);
  }

  const data = await r.json();
  return data.access_token;
}

function makeSignature(body) {
  const payload = JSON.stringify(body);
  const hash = crypto
    .createHash("md5")
    .update(payload + PAYU_MD5)
    .digest("hex");

  return `sender=${PAYU_POS_ID};signature=${hash};algorithm=MD5;content=APPLICATION_JSON`;
}

// ================== PAYU CREATE ORDER API ==================
app.post("/api/payu/order", async (req, res) => {
  try {
    const { customer, cart, total } = req.body;

    if (!cart?.length || !total) {
      return res.status(400).json({ error: "Brak koszyka lub kwoty." });
    }

    const token = await getPayuToken();
    const localOrderId = "EATMI-" + Date.now();

    const orderBody = {
      notifyUrl: NOTIFY_URL,
      continueUrl: CONTINUE_URL,

      customerIp:
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        "127.0.0.1",

      merchantPosId: PAYU_POS_ID,
      description: `Zamówienie eatmi.pl #${localOrderId}`,
      currencyCode: "PLN",
      totalAmount: String(Math.round(total * 100)), // grosze

      buyer: {
        email: customer?.email || "klient@eatmi.pl",
        phone: customer?.telefon || "",
        firstName:
          (customer?.imieNazwisko || "").split(" ")[0] || "Klient",
        lastName:
          (customer?.imieNazwisko || "")
            .split(" ")
            .slice(1)
            .join(" ") || "Eatmi",
        language: "pl",
      },

      products: cart.map((i) => ({
        name: i.name,
        unitPrice: String(Math.round(i.price * 100)),
        quantity: String(i.qty || 1),
      })),

      externalOrderId: localOrderId,
    };

    const sig = makeSignature(orderBody);

    const createRes = await fetch(`${PAYU_BASE}/api/v2_1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "OpenPayu-Signature": sig,
      },
      body: JSON.stringify(orderBody),
    });

    const createText = await createRes.text();
    if (!createRes.ok) {
      throw new Error("PayU create order error: " + createText);
    }

    const createData = JSON.parse(createText);

    const redirectUri = createData?.redirectUri;
    const payuOrderId = createData?.orderId;

    // zapis do podglądu
    const orders = readOrders();
    orders.push({
      localOrderId,
      payuOrderId,
      status: "PENDING",
      total,
      cart,
      customer,
      createdAt: new Date().toISOString(),
    });
    saveOrders(orders);

    return res.json({ redirectUri, localOrderId, payuOrderId });
  } catch (err) {
    console.error("PAYU ERROR:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ================== PAYU NOTIFY (WEBHOOK) ==================
app.post("/api/payu/notify", (req, res) => {
  try {
    const data = req.body;
    const order = data?.orders?.[0];
    if (!order) return res.sendStatus(200);

    const payuOrderId = order.orderId;
    const status = order.status;

    const orders = readOrders();
    const idx = orders.findIndex((o) => o.payuOrderId === payuOrderId);

    if (idx !== -1) {
      orders[idx].status = status;
      orders[idx].updatedAt = new Date().toISOString();
      saveOrders(orders);
    }

    console.log("PAYU NOTIFY:", payuOrderId, status);
    return res.sendStatus(200);
  } catch (e) {
    console.log("NOTIFY ERROR:", e.message);
    return res.sendStatus(200);
  }
});

// ================== OPTIONAL: PODGLĄD ZAMÓWIEŃ ==================
app.get("/api/orders", (req, res) => {
  res.json(readOrders());
});

// ================== STATIC FRONT ==================
// index.html jest obok server.js, więc statyki serwujemy z root folderu:
const PUBLIC_DIR = __dirname;

app.use(express.static(PUBLIC_DIR));

// SPA fallback – zawsze index.html z tego samego folderu
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});


// ================== START ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("eatmi backend running on port", PORT);
});


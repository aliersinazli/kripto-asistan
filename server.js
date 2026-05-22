const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// Binance imza oluşturucu
function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

// Binance'e istek atan yardımcı fonksiyon
function binanceRequest(path, params, apiKey, apiSecret) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const queryString = new URLSearchParams({ ...params, timestamp }).toString();
    const signature = sign(queryString, apiSecret);
    const fullPath = `/api/v3/${path}?${queryString}&signature=${signature}`;

    const options = {
      hostname: 'api.binance.com',
      path: fullPath,
      method: 'GET',
      headers: { 'X-MBX-APIKEY': apiKey }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Fiyat çek (public, auth gerekmez)
function getPrice(symbol) {
  return new Promise((resolve, reject) => {
    const path = `/api/v3/ticker/24hr?symbol=${symbol}`;
    https.get(`https://api.binance.com${path}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── ROUTES ──────────────────────────────────────────

// Sunucu sağlık kontrolü
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Hesap bilgisi + bakiye
app.post('/account', async (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'API bilgileri eksik' });
  try {
    const data = await binanceRequest('account', {}, apiKey, apiSecret);

    // Binance hata kodu döndürdüyse
    if (data.code) return res.status(400).json({ error: `Binance hatası: ${data.msg} (kod: ${data.code})` });

    // balances alanı yoksa veya dizi değilse
    if (!data.balances || !Array.isArray(data.balances)) {
      return res.status(400).json({ error: 'Binance beklenmedik yanıt döndürdü. API izinlerini kontrol et (sadece Okuma izni olmalı).', raw: JSON.stringify(data).slice(0, 200) });
    }

    // Sıfırdan büyük bakiyeleri filtrele
    const balances = data.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    res.json({ balances, makerCommission: data.makerCommission });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Açık emirler
app.post('/open-orders', async (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'API bilgileri eksik' });
  try {
    const data = await binanceRequest('openOrders', {}, apiKey, apiSecret);
    if (data.code) return res.status(400).json({ error: data.msg });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// İşlem geçmişi
app.post('/my-trades', async (req, res) => {
  const { apiKey, apiSecret, symbol } = req.body;
  if (!apiKey || !apiSecret || !symbol) return res.status(400).json({ error: 'Eksik parametre' });
  try {
    const data = await binanceRequest('myTrades', { symbol, limit: 20 }, apiKey, apiSecret);
    if (data.code) return res.status(400).json({ error: data.msg });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 24 saatlik fiyat verisi (public)
app.get('/prices', async (req, res) => {
  const symbols = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','AVAXUSDT','LINKUSDT','ADAUSDT','DOTUSDT','MATICUSDT','ATOMUSDT'];
  try {
    const results = await Promise.all(symbols.map(s => getPrice(s)));
    res.json(results.map(r => ({
      symbol: r.symbol,
      price: parseFloat(r.lastPrice).toFixed(4),
      change: parseFloat(r.priceChangePercent).toFixed(2),
      volume: r.quoteVolume,
      high: r.highPrice,
      low: r.lowPrice
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kripto Asistan sunucu çalışıyor: port ${PORT}`));

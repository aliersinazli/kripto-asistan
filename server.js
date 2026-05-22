const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

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
        catch (e) { reject(new Error('JSON parse hatası: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getPrice(symbol) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// DEBUG endpoint — Binance'den ham veriyi göster
app.post('/debug', async (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'Eksik' });
  try {
    const data = await binanceRequest('account', { omitZeroBalances: true }, apiKey, apiSecret);
    res.json({
      type: typeof data,
      isArray: Array.isArray(data),
      keys: typeof data === 'object' ? Object.keys(data) : [],
      hasBalances: data && data.balances ? true : false,
      balancesType: data && data.balances ? typeof data.balances : 'yok',
      isBalancesArray: data && data.balances ? Array.isArray(data.balances) : false,
      code: data ? data.code : null,
      msg: data ? data.msg : null,
      sample: JSON.stringify(data).slice(0, 400)
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/account', async (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'API bilgileri eksik' });
  try {
    const data = await binanceRequest('account', { omitZeroBalances: true }, apiKey, apiSecret);

    if (!data) return res.status(400).json({ error: 'Binance boş yanıt döndürdü' });
    if (data.code) return res.status(400).json({ error: `Binance: ${data.msg} (${data.code})` });
    if (!Array.isArray(data.balances)) {
      return res.status(400).json({
        error: 'Beklenmedik format',
        keys: Object.keys(data),
        raw: JSON.stringify(data).slice(0, 300)
      });
    }

    const balances = data.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    res.json({ balances, makerCommission: data.makerCommission });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/open-orders', async (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'API bilgileri eksik' });
  try {
    const data = await binanceRequest('openOrders', {}, apiKey, apiSecret);
    if (data.code) return res.status(400).json({ error: data.msg });
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
app.listen(PORT, () => console.log(`Kripto Asistan sunucu: port ${PORT}`));

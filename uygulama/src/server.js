const express = require('express');
const session = require('express-session');
const { closePools } = require('./database');
const api = require('./routes');

const app = express();
const port = Number(process.env.PORT || 8000);
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 24) {
  throw new Error('SESSION_SECRET en az 24 karakter olarak ayarlanmalıdır.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'yemekhane.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 30 * 60 * 1000
  }
}));

app.use('/api', api);
app.use((_req, res) => res.status(404).json({ error: 'İstek yolu bulunamadı.' }));

app.use((error, req, res, _next) => {
  if (res.headersSent) return;
  if (error.errno === 1644 || error.sqlState === '45000') {
    return res.status(400).json({ error: error.sqlMessage || error.message });
  }
  if (error.errno === 1062) {
    return res.status(409).json({ error: 'Bu yemekhane, tarih ve öğün için zaten bir menü var.' });
  }
  if (error.errno === 1452 || error.errno === 3819) {
    console.error('Veri doğrulama/veritabanı kısıtı:', error.code, req.method, req.originalUrl);
    return res.status(400).json({ error: 'Gönderilen bilgiler veritabanı kurallarına uymuyor.' });
  }
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status : 500;
  if (status >= 500) console.error('API hatası:', error.code || error.name, req.method, req.originalUrl);
  return res.status(status).json({
    error: status === 500 ? 'İşlem tamamlanamadı. Lütfen daha sonra tekrar dene.' : error.message
  });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Yemekhane API ${port} portunda hazır.`);
});

async function shutdown(signal) {
  console.log(`${signal} alındı, uygulama kapatılıyor.`);
  server.close(async () => {
    await closePools();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

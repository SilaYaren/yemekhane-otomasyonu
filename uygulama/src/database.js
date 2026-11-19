const mysql = require('mysql2/promise');

const poolOptions = {
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_KULLANICI,
  password: process.env.DB_SIFRE,
  database: process.env.DB_ADI,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+03:00',
  dateStrings: true,
  decimalNumbers: true
};

const writePool = mysql.createPool({ ...poolOptions, host: process.env.DB_YAZMA_HOST });
const readPool = mysql.createPool({ ...poolOptions, host: process.env.DB_OKUMA_HOST });

async function closePools() {
  await Promise.all([writePool.end(), readPool.end()]);
}

module.exports = { writePool, readPool, closePools };

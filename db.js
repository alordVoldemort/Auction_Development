const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 3,
  acquireTimeout: 10000,
  idleTimeout: 60000,
});

// ➜  force every new connection to Asia/Kolkata
db.on('connection', conn => {
  conn.query(`SET time_zone = '+05:30';`);
});

// Test connection
db.getConnection()
  .then((connection) => {
    console.log('✅ Database connected successfully!');
    connection.release();
  })
  .catch((err) => {
    console.error('❌ Database connection error:', err.message);
  });

// safeQuery helper remains unchanged
db.safeQuery = async (sql, params = []) => {
  let connection;
  try {
    connection = await db.getConnection();
    const [results] = await connection.execute(sql, params);
    return results;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

module.exports = db;

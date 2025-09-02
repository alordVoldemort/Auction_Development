const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool with only valid settings
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 3, // Most important setting to fix your issue
  acquireTimeout: 10000, // 10 second timeout
  idleTimeout: 60000, // 60 second idle timeout
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

// Add custom query function to ensure proper connection handling
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
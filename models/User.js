const db = require('../db');

class User {
  static async findByPhone(phone_number) {
    const [users] = await db.query('SELECT * FROM users WHERE phone_number = ?', [phone_number]);
    return users[0];
  }

  static async findById(id) {
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    return users[0];
  }

  static async create(userData) {
    const { company_name, phone_number, person_name, email, company_address } = userData;
    
    const [result] = await db.query(
      'INSERT INTO users (company_name, phone_number, person_name, email, company_address) VALUES (?, ?, ?, ?, ?)',
      [company_name, phone_number, person_name, email, company_address]
    );
    
    return result.insertId;
  }

  static async promoteToAdmin(phone_number) {
    const [result] = await db.query(
      'UPDATE users SET is_admin = TRUE WHERE phone_number = ?',
      [phone_number]
    );
    
    return result.affectedRows;
  }

  static async findAll() {
    const [users] = await db.query(
      'SELECT id, company_name, phone_number, person_name, email, company_address, is_admin, created_at FROM users ORDER BY created_at DESC'
    );
    
    return users;
  }
}

module.exports = User;
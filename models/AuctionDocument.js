const db = require('../db');

class AuctionDocument {
  static async add(documentData) {
    const { auction_id, file_name, file_path, file_type } = documentData;
    
    const [result] = await db.query(
      'INSERT INTO auction_documents (auction_id, file_name, file_path, file_type) VALUES (?, ?, ?, ?)',
      [auction_id, file_name, file_path, file_type]
    );
    
    return result.insertId;
  }

  static async findByAuction(auctionId) {
    const [documents] = await db.query(
      'SELECT * FROM auction_documents WHERE auction_id = ? ORDER BY uploaded_at DESC',
      [auctionId]
    );
    return documents;
  }

  static async delete(id) {
    const [result] = await db.query(
      'DELETE FROM auction_documents WHERE id = ?',
      [id]
    );
    return result.affectedRows;
  }
}

module.exports = AuctionDocument;
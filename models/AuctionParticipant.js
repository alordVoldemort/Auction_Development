const db = require('../db');

class AuctionParticipant {
  static async add(participantData) {
    const { auction_id, user_id, phone_number } = participantData;
    
    const [existing] = await db.query(
      'SELECT id FROM auction_participants WHERE auction_id = ? AND phone_number = ?',
      [auction_id, phone_number]
    );
    
    if (existing.length > 0) {
      return existing[0].id;
    }
    
    const [result] = await db.query(
      'INSERT INTO auction_participants (auction_id, user_id, phone_number) VALUES (?, ?, ?)',
      [auction_id, user_id, phone_number]
    );
    
    return result.insertId;
  }

  static async addMultiple(auctionId, participants) {
    if (participants.length === 0) return 0;
    
    const values = participants.map(p => 
      `(${auctionId}, ${p.user_id || 'NULL'}, '${p.phone_number.replace(/'/g, "''")}')`
    ).join(',');
    
    const [result] = await db.query(
      `INSERT IGNORE INTO auction_participants (auction_id, user_id, phone_number) 
       VALUES ${values}`
    );
    
    return result.affectedRows;
  }

  static async findByAuction(auctionId) {
    const [participants] = await db.query(
      `SELECT ap.*, u.company_name, u.person_name 
       FROM auction_participants ap 
       LEFT JOIN users u ON ap.user_id = u.id 
       WHERE ap.auction_id = ? 
       ORDER BY ap.invited_at DESC`,
      [auctionId]
    );
    return participants;
  }

  static async isParticipant(auctionId, phoneNumber) {
    const [participants] = await db.query(
      'SELECT id FROM auction_participants WHERE auction_id = ? AND phone_number = ?',
      [auctionId, phoneNumber]
    );
    return participants.length > 0;
  }

  static async updateStatus(auctionId, phoneNumber, status) {
    const query = status === 'joined' 
      ? 'UPDATE auction_participants SET status = ?, joined_at = NOW() WHERE auction_id = ? AND phone_number = ?'
      : 'UPDATE auction_participants SET status = ? WHERE auction_id = ? AND phone_number = ?';
    
    const [result] = await db.query(query, [status, auctionId, phoneNumber]);
    return result.affectedRows;
  }
}

module.exports = AuctionParticipant;
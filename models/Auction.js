const db = require('../db');

class Auction {
  static async create(auctionData) {
    const {
      title,
      description,
      auction_date,
      start_time,
      duration,
      currency,
      base_price,
      decremental_value,
      pre_bid_allowed,
      created_by
    } = auctionData;

    // Determine initial status based on start time
    const auctionDateTime = new Date(`${auction_date}T${start_time}`);
    const now = new Date();
    const initialStatus = auctionDateTime > now ? 'upcoming' : 'live';

    const [result] = await db.query(
      `INSERT INTO auctions 
       (title, description, auction_date, start_time, duration, currency, 
        base_price, current_price, decremental_value, pre_bid_allowed, created_by, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, auction_date, start_time, duration, currency, 
       base_price, base_price, decremental_value, pre_bid_allowed, created_by, initialStatus]
    );

    return result.insertId;
  }

  static async findById(id) {
    const [auctions] = await db.query(
      `SELECT a.*, u.company_name as creator_company, u.person_name as creator_name 
       FROM auctions a 
       JOIN users u ON a.created_by = u.id 
       WHERE a.id = ?`,
      [id]
    );
    return auctions[0];
  }

  static async findByUser(userId, status = null) {
    let query = `
      SELECT a.*, u.company_name as creator_company, u.person_name as creator_name,
             (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as bid_count,
             (SELECT COUNT(*) FROM auction_participants WHERE auction_id = a.id) as participant_count
      FROM auctions a 
      JOIN users u ON a.created_by = u.id 
      WHERE a.created_by = ?
    `;
    
    const params = [userId];
    
    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY a.created_at DESC';
    
    const [auctions] = await db.query(query, params);
    return auctions;
  }

  static async findLive() {
    const [auctions] = await db.query(
      `SELECT a.*, u.company_name as creator_company, u.person_name as creator_name,
             (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as bid_count
       FROM auctions a 
       JOIN users u ON a.created_by = u.id 
       WHERE a.status = 'live' 
       ORDER BY a.auction_date, a.start_time`
    );
    return auctions;
  }

  static async updateStatus(id, status, winnerId = null) {
    let query = 'UPDATE auctions SET status = ?, updated_at = NOW() WHERE id = ?';
    const params = [status, id];
    
    if (winnerId) {
      query = 'UPDATE auctions SET status = ?, winner_id = ?, updated_at = NOW() WHERE id = ?';
      params.splice(1, 0, winnerId);
    }
    
    const [result] = await db.query(query, params);
    return result.affectedRows;
  }

  static async updateCurrentPrice(id, price) {
    const [result] = await db.query(
      'UPDATE auctions SET current_price = ?, updated_at = NOW() WHERE id = ?',
      [price, id]
    );
    return result.affectedRows;
  }

  // Add this new method for finding auctions by participant
  static async findByParticipant(userId, status = null) {
    let query = `
      SELECT DISTINCT a.*, u.company_name as creator_company, u.person_name as creator_name,
             (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as bid_count,
             (SELECT COUNT(*) FROM auction_participants WHERE auction_id = a.id) as participant_count
      FROM auctions a 
      JOIN users u ON a.created_by = u.id 
      JOIN bids b ON a.id = b.auction_id
      WHERE b.user_id = ?
    `;
    
    const params = [userId];
    
    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY a.auction_date DESC, a.start_time DESC';
    
    const [auctions] = await db.query(query, params);
    return auctions;
  }

  // Add this method to fix existing NULL status auctions
  static async fixNullStatusAuctions() {
    try {
      // Update auctions with NULL status based on their dates
      const [result] = await db.query(`
        UPDATE auctions 
        SET status = CASE 
          WHEN CONCAT(auction_date, ' ', start_time) > NOW() THEN 'upcoming'
          WHEN NOW() BETWEEN CONCAT(auction_date, ' ', start_time) 
                      AND DATE_ADD(CONCAT(auction_date, ' ', start_time), INTERVAL duration SECOND) THEN 'live'
          ELSE 'completed'
        END
        WHERE status IS NULL
      `);
      
      console.log(`✅ Fixed ${result.affectedRows} auctions with NULL status`);
      return result.affectedRows;
    } catch (error) {
      console.error('Error fixing NULL status auctions:', error);
      throw error;
    }
  }
}

module.exports = Auction;
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
      decremental_value,
      current_price,
      pre_bid_allowed,
      created_by
    } = auctionData;

    const [result] = await db.query(
      `INSERT INTO auctions 
       (title, description, auction_date, start_time, duration, currency, 
        decremental_value, current_price, pre_bid_allowed, created_by, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')`,
      [
        title,
        description,
        auction_date,
        start_time,
        duration,
        currency,
        decremental_value,
        current_price,
        pre_bid_allowed,
        created_by
      ]
    );

    return result.insertId;
  }

  static async findById(id) {
    const [rows] = await db.query('SELECT * FROM auctions WHERE id = ?', [id]);
    return rows[0];
  }

  static async findByUser(userId, status = null) {
    let query = 'SELECT * FROM auctions WHERE created_by = ?';
    const params = [userId];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await db.query(query, params);
    return rows;
  }

  static async findLive() {
    const [rows] = await db.query(
      `SELECT a.*, u.company_name as creator_company, u.person_name as creator_name 
       FROM auctions a 
       JOIN users u ON a.created_by = u.id 
       WHERE a.status = 'live' 
       ORDER BY a.auction_date, a.start_time`
    );
    return rows;
  }

  static async updateCurrentPrice(id, price) {
    await db.query(
      'UPDATE auctions SET current_price = ? WHERE id = ?',
      [price, id]
    );
  }

  static async updateStatus(id, status, winner_id = null) {
    if (winner_id) {
      await db.query(
        'UPDATE auctions SET status = ?, winner_id = ? WHERE id = ?',
        [status, winner_id, id]
      );
    } else {
      await db.query(
        'UPDATE auctions SET status = ? WHERE id = ?',
        [status, id]
      );
    }
  }

  static async delete(id) {
    await db.query('DELETE FROM auctions WHERE id = ?', [id]);
  }

  // NEW: Get auctions with filters for status and search
  static async findWithFilters(userId, filters = {}) {
    let query = `
      SELECT a.*, u.company_name as creator_company, u.person_name as creator_name,
             (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as bid_count,
             (SELECT COUNT(*) FROM auction_participants WHERE auction_id = a.id) as participant_count,
             EXISTS(SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?) as has_participated
      FROM auctions a 
      JOIN users u ON a.created_by = u.id 
      WHERE 1=1
    `;
    
    const params = [userId];
    
    // Filter by type (created or participated)
    if (filters.type === 'created') {
      query += ' AND a.created_by = ?';
      params.push(userId);
    } else if (filters.type === 'participated') {
      query += ' AND EXISTS(SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?)';
      params.push(userId);
    }
    
    // Filter by status
    if (filters.status && filters.status !== 'all') {
      query += ' AND a.status = ?';
      params.push(filters.status);
    }
    
    // Search filter
    if (filters.search) {
      query += ' AND (a.title LIKE ? OR a.description LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    
    query += ' ORDER BY a.auction_date DESC, a.start_time DESC';
    
    const [rows] = await db.query(query, params);
    return rows;
  }

  // NEW: Get completed auctions for report generation
  static async findCompletedForReport(userId) {
    const [rows] = await db.query(
      `SELECT a.*, u.company_name as creator_company, u.person_name as creator_name,
              u.email as creator_email, u.company_address as creator_address
       FROM auctions a 
       JOIN users u ON a.created_by = u.id 
       WHERE a.status = 'completed' AND a.created_by = ?
       ORDER BY a.auction_date DESC, a.start_time DESC`,
      [userId]
    );
    return rows;
  }

  // NEW: Update auction end time
  static async updateEndTime(id, endTime) {
    await db.query(
      'UPDATE auctions SET end_time = ? WHERE id = ?',
      [endTime, id]
    );
  }

  // NEW: Extend auction duration
  static async extendDuration(id, additionalMinutes) {
    const newDuration = await db.query(
      'SELECT duration + (? * 60) as new_duration FROM auctions WHERE id = ?',
      [additionalMinutes, id]
    );
    
    await db.query(
      'UPDATE auctions SET duration = duration + (? * 60) WHERE id = ?',
      [additionalMinutes, id]
    );
    
    return newDuration[0][0].new_duration;
  }

  // NEW: Check if user is auction creator
  static async isCreator(auctionId, userId) {
    const [rows] = await db.query(
      'SELECT COUNT(*) as count FROM auctions WHERE id = ? AND created_by = ?',
      [auctionId, userId]
    );
    return rows[0].count > 0;
  }

  // NEW: Get auction count by status
  static async getCountByStatus(userId) {
    const [rows] = await db.query(
      `SELECT status, COUNT(*) as count 
       FROM auctions 
       WHERE created_by = ? 
       GROUP BY status`,
      [userId]
    );
    return rows;
  }

  // NEW: Get recent auctions
  static async findRecent(limit = 5) {
    const [rows] = await db.query(
      `SELECT a.*, u.company_name as creator_company, u.person_name as creator_name 
       FROM auctions a 
       JOIN users u ON a.created_by = u.id 
       ORDER BY a.created_at DESC 
       LIMIT ?`,
      [limit]
    );
    return rows;
  }
}

module.exports = Auction;
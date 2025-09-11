const db = require('../db');
const { toISTDate, istDateString, normaliseRow } = require('../utils/ist');

class Auction {
  /* ----------------------  CREATE  -------------------------- */
  static async create(auctionData) {
    const {
      title,
      description,
      auction_date,          // "2025-09-08"  (IST calendar day)
      start_time,
      duration,
      currency,
      decremental_value,
      current_price,
      pre_bid_allowed,
      created_by
    } = auctionData;

    const istYMD = auction_date; // already IST from frontend

    const [result] = await db.query(
      `INSERT INTO auctions 
       (title, description, auction_date, start_time, duration, currency, 
        decremental_value, current_price, pre_bid_allowed, created_by, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')`,
      [
        title,
        description,
        istYMD,          // <-- locked to IST
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

  /* ----------------------  READ  ---------------------------- */
  static async findById(id) {
    const [rows] = await db.query('SELECT * FROM auctions WHERE id = ?', [id]);
    return normaliseRow(rows[0]);
  }

  static async findByUser(userId, status = null) {
    let q = 'SELECT * FROM auctions WHERE created_by = ?';
    const p = [userId];
    if (status) { q += ' AND status = ?'; p.push(status); }
    q += ' ORDER BY created_at DESC';
    const [rows] = await db.query(q, p);
    return rows.map(normaliseRow);
  }

  static async findLive() {
    const [rows] = await db.query(
      `SELECT a.*, u.company_name AS creator_company, u.person_name AS creator_name
       FROM auctions a
       JOIN users u ON a.created_by = u.id
       WHERE a.status = 'live'
       ORDER BY a.auction_date, a.start_time`
    );
    return rows.map(normaliseRow);
  }

  /* ----------------------  UPDATE  -------------------------- */
  static async updateCurrentPrice(id, price) {
    await db.query('UPDATE auctions SET current_price = ? WHERE id = ?', [price, id]);
  }

  static async updateStatus(id, status, winner_id = null) {
    if (winner_id) {
      await db.query(
        'UPDATE auctions SET status = ?, winner_id = ? WHERE id = ?',
        [status, winner_id, id]
      );
    } else {
      await db.query('UPDATE auctions SET status = ? WHERE id = ?', [status, id]);
    }
  }

  static async updateEndTime(id, endTime) {
    await db.query('UPDATE auctions SET end_time = ? WHERE id = ?', [endTime, id]);
  }

  static async extendDuration(id, additionalMinutes) {
    await db.query(
      'UPDATE auctions SET duration = duration + (? * 60) WHERE id = ?',
      [additionalMinutes, id]
    );
    const [rows] = await db.query('SELECT duration FROM auctions WHERE id = ?', [id]);
    return rows[0].duration;
  }

  /* ----------------------  DELETE  -------------------------- */
  static async delete(id) {
    await db.query('DELETE FROM auctions WHERE id = ?', [id]);
  }

  /* ----------------------  FILTERS / REPORTS  -------------- */
  static async findWithFilters(userId, filters = {}) {
    let q = `
      SELECT a.*, u.company_name AS creator_company, u.person_name AS creator_name,
             (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) AS bid_count,
             (SELECT COUNT(*) FROM auction_participants WHERE auction_id = a.id) AS participant_count,
             EXISTS(SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?) AS has_participated
      FROM auctions a
      JOIN users u ON a.created_by = u.id
      WHERE 1=1 `;
    const p = [userId];

    if (filters.type === 'created') { q += ' AND a.created_by = ?'; p.push(userId); } 
    else if (filters.type === 'participated') { q += ' AND EXISTS(SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?)'; p.push(userId); }

    if (filters.status && filters.status !== 'all') { q += ' AND a.status = ?'; p.push(filters.status); }

    if (filters.search) { q += ' AND (a.title LIKE ? OR a.description LIKE ?)'; p.push(`%${filters.search}%`, `%${filters.search}%`); }

    q += ' ORDER BY a.auction_date DESC, a.start_time DESC';
    const [rows] = await db.query(q, p);
    return rows.map(normaliseRow);
  }

  static async findCompletedForReport(userId) {
    const [rows] = await db.query(
      `SELECT a.*, u.company_name AS creator_company, u.person_name AS creator_name,
              u.email AS creator_email, u.company_address AS creator_address
       FROM auctions a
       JOIN users u ON a.created_by = u.id
       WHERE a.status = 'completed' AND a.created_by = ?
       ORDER BY a.auction_date DESC, a.start_time DESC`,
      [userId]
    );
    return rows.map(normaliseRow);
  }

  /* ----------------------  UTILS  --------------------------- */
  static async isCreator(auctionId, userId) {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS count FROM auctions WHERE id = ? AND created_by = ?',
      [auctionId, userId]
    );
    return rows[0].count > 0;
  }

  static async getCountByStatus(userId) {
    const [rows] = await db.query(
      `SELECT status, COUNT(*) AS count
       FROM auctions
       WHERE created_by = ?
       GROUP BY status`,
      [userId]
    );
    return rows;
  }

  static async findRecent(limit = 5) {
    const [rows] = await db.query(
      `SELECT a.*, u.company_name AS creator_company, u.person_name AS creator_name
       FROM auctions a
       JOIN users u ON a.created_by = u.id
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [limit]
    );
    return rows.map(normaliseRow);
  }
}

module.exports = Auction;

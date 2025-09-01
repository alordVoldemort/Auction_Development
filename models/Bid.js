const db = require('../db');

class Bid {
  static async create(bidData, session = null) {
    const { auction_id, user_id, amount } = bidData;
    
    const query = 'INSERT INTO bids (auction_id, user_id, amount) VALUES (?, ?, ?)';
    const params = [auction_id, user_id, amount];
    
    if (session) {
      const [result] = await session.query(query, params);
      return result.insertId;
    } else {
      const [result] = await db.query(query, params);
      return result.insertId;
    }
  }

  static async findByAuction(auctionId, session = null) {
    const query = `
      SELECT b.*, u.company_name, u.person_name 
      FROM bids b 
      JOIN users u ON b.user_id = u.id 
      WHERE b.auction_id = ? 
      ORDER BY b.bid_time DESC
    `;
    
    if (session) {
      const [bids] = await session.query(query, [auctionId]);
      return bids;
    } else {
      const [bids] = await db.query(query, [auctionId]);
      return bids;
    }
  }

  static async findWinningBid(auctionId, session = null) {
    const query = `
      SELECT b.*, u.company_name, u.person_name 
      FROM bids b 
      JOIN users u ON b.user_id = u.id 
      WHERE b.auction_id = ? AND b.is_winning = TRUE
    `;
    
    if (session) {
      const [bids] = await session.query(query, [auctionId]);
      return bids[0];
    } else {
      const [bids] = await db.query(query, [auctionId]);
      return bids[0];
    }
  }

  static async setWinningBid(bidId, session = null) {
    // First get auction_id from the bid
    let query = 'SELECT auction_id FROM bids WHERE id = ?';
    
    let bid;
    if (session) {
      [bid] = await session.query(query, [bidId]);
    } else {
      [bid] = await db.query(query, [bidId]);
    }
    
    if (bid.length === 0) return 0;
    
    // Set all other bids as non-winning
    query = 'UPDATE bids SET is_winning = FALSE WHERE auction_id = ?';
    
    if (session) {
      await session.query(query, [bid[0].auction_id]);
    } else {
      await db.query(query, [bid[0].auction_id]);
    }
    
    // Set this bid as winning
    query = 'UPDATE bids SET is_winning = TRUE WHERE id = ?';
    
    if (session) {
      const [result] = await session.query(query, [bidId]);
      return result.affectedRows;
    } else {
      const [result] = await db.query(query, [bidId]);
      return result.affectedRows;
    }
  }

  static async findByUser(userId, session = null) {
    const query = `
      SELECT b.*, a.title as auction_title, a.status as auction_status 
      FROM bids b 
      JOIN auctions a ON b.auction_id = a.id 
      WHERE b.user_id = ? 
      ORDER BY b.bid_time DESC
    `;
    
    if (session) {
      const [bids] = await session.query(query, [userId]);
      return bids;
    } else {
      const [bids] = await db.query(query, [userId]);
      return bids;
    }
  }

  static async getLastBid(auctionId, userId, session = null) {
    const query = `
      SELECT * FROM bids 
      WHERE auction_id = ? AND user_id = ? 
      ORDER BY bid_time DESC 
      LIMIT 1
    `;
    
    if (session) {
      const [bids] = await session.query(query, [auctionId, userId]);
      return bids[0];
    } else {
      const [bids] = await db.query(query, [auctionId, userId]);
      return bids[0];
    }
  }

  static async getBidCount(auctionId, session = null) {
    const query = 'SELECT COUNT(*) as count FROM bids WHERE auction_id = ?';
    
    if (session) {
      const [result] = await session.query(query, [auctionId]);
      return result[0].count;
    } else {
      const [result] = await db.query(query, [auctionId]);
      return result[0].count;
    }
  }

  static async getHighestBid(auctionId, session = null) {
    const query = `
      SELECT b.*, u.company_name, u.person_name 
      FROM bids b 
      JOIN users u ON b.user_id = u.id 
      WHERE b.auction_id = ? 
      ORDER BY b.amount DESC 
      LIMIT 1
    `;
    
    if (session) {
      const [bids] = await session.query(query, [auctionId]);
      return bids[0];
    } else {
      const [bids] = await db.query(query, [auctionId]);
      return bids[0];
    }
  }

  static async getLowestBid(auctionId, session = null) {
    const query = `
      SELECT b.*, u.company_name, u.person_name 
      FROM bids b 
      JOIN users u ON b.user_id = u.id 
      WHERE b.auction_id = ? 
      ORDER BY b.amount ASC 
      LIMIT 1
    `;
    
    if (session) {
      const [bids] = await session.query(query, [auctionId]);
      return bids[0];
    } else {
      const [bids] = await db.query(query, [auctionId]);
      return bids[0];
    }
  }

  static async getUserBidStats(userId, session = null) {
    const query = `
      SELECT 
        COUNT(*) as total_bids,
        COUNT(DISTINCT auction_id) as auctions_participated,
        SUM(CASE WHEN is_winning = TRUE THEN 1 ELSE 0 END) as winning_bids
      FROM bids 
      WHERE user_id = ?
    `;
    
    if (session) {
      const [stats] = await session.query(query, [userId]);
      return stats[0];
    } else {
      const [stats] = await db.query(query, [userId]);
      return stats[0];
    }
  }

  static async deleteBid(bidId, session = null) {
    const query = 'DELETE FROM bids WHERE id = ?';
    
    if (session) {
      const [result] = await session.query(query, [bidId]);
      return result.affectedRows;
    } else {
      const [result] = await db.query(query, [bidId]);
      return result.affectedRows;
    }
  }

  static async getBidsWithTimeRange(auctionId, startTime, endTime, session = null) {
    const query = `
      SELECT b.*, u.company_name, u.person_name 
      FROM bids b 
      JOIN users u ON b.user_id = u.id 
      WHERE b.auction_id = ? 
      AND b.bid_time BETWEEN ? AND ?
      ORDER BY b.bid_time DESC
    `;
    
    if (session) {
      const [bids] = await session.query(query, [auctionId, startTime, endTime]);
      return bids;
    } else {
      const [bids] = await db.query(query, [auctionId, startTime, endTime]);
      return bids;
    }
  }

  static async getBidHistory(auctionId, limit = 50, session = null) {
    const query = `
      SELECT b.*, u.company_name, u.person_name 
      FROM bids b 
      JOIN users u ON b.user_id = u.id 
      WHERE b.auction_id = ? 
      ORDER BY b.bid_time DESC 
      LIMIT ?
    `;
    
    if (session) {
      const [bids] = await session.query(query, [auctionId, limit]);
      return bids;
    } else {
      const [bids] = await db.query(query, [auctionId, limit]);
      return bids;
    }
  }
}

module.exports = Bid;
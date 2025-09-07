const db = require('../db');

class Bid {
  static async create({ auction_id, user_id, amount }) {
    try {
      const [result] = await db.query(
        'INSERT INTO bids (auction_id, user_id, amount, bid_time) VALUES (?, ?, ?, NOW())',
        [auction_id, user_id, amount]
      );
      return result.insertId;
    } catch (error) {
      throw error;
    }
  }

  static async findByAuction(auctionId) {
    try {
      const [bids] = await db.query(`
        SELECT b.*, u.person_name, u.company_name 
        FROM bids b 
        LEFT JOIN users u ON b.user_id = u.id 
        WHERE b.auction_id = ? 
        ORDER BY b.amount ASC, b.bid_time ASC
      `, [auctionId]);
      return bids;
    } catch (error) {
      throw error;
    }
  }

  static async findWinningBid(auctionId) {
    try {
      const [bids] = await db.query(`
        SELECT b.*, u.person_name, u.company_name 
        FROM bids b 
        LEFT JOIN users u ON b.user_id = u.id 
        WHERE b.auction_id = ? AND b.is_winning = 1 
        LIMIT 1
      `, [auctionId]);
      return bids[0] || null;
    } catch (error) {
      throw error;
    }
  }

  static async setWinningBid(bidId) {
    try {
      // First reset all winning bids for this auction
      const bid = await this.findById(bidId);
      if (bid) {
        await db.query(
          'UPDATE bids SET is_winning = 0 WHERE auction_id = ?',
          [bid.auction_id]
        );
        
        // Set the new winning bid
        await db.query(
          'UPDATE bids SET is_winning = 1 WHERE id = ?',
          [bidId]
        );
      }
    } catch (error) {
      throw error;
    }
  }

  static async findById(bidId) {
    try {
      const [bids] = await db.query(
        'SELECT * FROM bids WHERE id = ?',
        [bidId]
      );
      return bids[0] || null;
    } catch (error) {
      throw error;
    }
  }

  static async findByUserAndAuction(userId, auctionId) {
    try {
      const [bids] = await db.query(
        'SELECT * FROM bids WHERE user_id = ? AND auction_id = ? ORDER BY bid_time DESC',
        [userId, auctionId]
      );
      return bids;
    } catch (error) {
      throw error;
    }
  }

  static async getHighestBid(auctionId) {
    try {
      const [bids] = await db.query(`
        SELECT b.*, u.person_name, u.company_name 
        FROM bids b 
        LEFT JOIN users u ON b.user_id = u.id 
        WHERE b.auction_id = ? 
        ORDER BY b.amount ASC 
        LIMIT 1
      `, [auctionId]);
      return bids[0] || null;
    } catch (error) {
      throw error;
    }
  }

  static async getLowestBid(auctionId) {
    try {
      const [bids] = await db.query(`
        SELECT b.*, u.person_name, u.company_name 
        FROM bids b 
        LEFT JOIN users u ON b.user_id = u.id 
        WHERE b.auction_id = ? 
        ORDER BY b.amount DESC 
        LIMIT 1
      `, [auctionId]);
      return bids[0] || null;
    } catch (error) {
      throw error;
    }
  }

  static async getBidCount(auctionId) {
    try {
      const [result] = await db.query(
        'SELECT COUNT(*) as count FROM bids WHERE auction_id = ?',
        [auctionId]
      );
      return result[0].count;
    } catch (error) {
      throw error;
    }
  }

  static async getUserBidCount(userId, auctionId) {
    try {
      const [result] = await db.query(
        'SELECT COUNT(*) as count FROM bids WHERE user_id = ? AND auction_id = ?',
        [userId, auctionId]
      );
      return result[0].count;
    } catch (error) {
      throw error;
    }
  }

  static async hasUserBid(auctionId, userId) {
    try {
      const [result] = await db.query(
        'SELECT COUNT(*) as count FROM bids WHERE auction_id = ? AND user_id = ?',
        [auctionId, userId]
      );
      return result[0].count > 0;
    } catch (error) {
      console.error('Error checking user bid:', error);
      return false;
    }
  }

  static async deleteBid(bidId) {
    try {
      await db.query(
        'DELETE FROM bids WHERE id = ?',
        [bidId]
      );
      return true;
    } catch (error) {
      throw error;
    }
  }

  static async deleteByAuction(auctionId) {
    try {
      await db.query(
        'DELETE FROM bids WHERE auction_id = ?',
        [auctionId]
      );
      return true;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = Bid;
const db = require('../db');
const moment = require('moment'); // make sure to install: npm install moment

// Reports & Analytics Overview
exports.getOverview = async (req, res) => {
  try {
    const { filter = 'this_month' } = req.query; // today, this_week, this_month, this_year

    let startDate, endDate;
    const now = moment();

    switch (filter) {
      case 'today':
        startDate = now.startOf('day').format('YYYY-MM-DD HH:mm:ss');
        endDate = now.endOf('day').format('YYYY-MM-DD HH:mm:ss');
        break;
      case 'this_week':
        startDate = now.startOf('week').format('YYYY-MM-DD HH:mm:ss');
        endDate = now.endOf('week').format('YYYY-MM-DD HH:mm:ss');
        break;
      case 'this_year':
        startDate = now.startOf('year').format('YYYY-MM-DD HH:mm:ss');
        endDate = now.endOf('year').format('YYYY-MM-DD HH:mm:ss');
        break;
      case 'this_month':
      default:
        startDate = now.startOf('month').format('YYYY-MM-DD HH:mm:ss');
        endDate = now.endOf('month').format('YYYY-MM-DD HH:mm:ss');
        break;
    }

    // Total Auctions and Completed Auctions
    const [auctionsData] = await db.query(
      `SELECT 
          COUNT(*) AS total_auctions,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_auctions
       FROM auctions
       WHERE created_at BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    // Total Users and New Users
    const [usersData] = await db.query(
      `SELECT
          COUNT(*) AS total_users,
          SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS new_users
       FROM users`,
      [startDate, endDate]
    );

    // Total Revenue and Avg Bid
    const [revenueData] = await db.query(
      `SELECT
          SUM(b.amount) AS total_revenue,
          AVG(b.amount) AS avg_bid
       FROM bids b
       LEFT JOIN auctions a ON b.auction_id = a.id
       WHERE a.created_at BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    // Participation Rate (joined participants / total participants)
    const [participationData] = await db.query(
      `SELECT 
          ROUND(SUM(CASE WHEN ap.status='joined' THEN 1 ELSE 0 END) / 
                SUM(1) * 100, 2) AS participation_rate
       FROM auction_participants ap
       LEFT JOIN auctions a ON ap.auction_id = a.id
       WHERE a.created_at BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    // Top Auction Category (example: top title by number of bids)
    const [topData] = await db.query(
      `SELECT a.title AS top_auction
       FROM auctions a
       LEFT JOIN bids b ON b.auction_id = a.id
       WHERE a.created_at BETWEEN ? AND ?
       GROUP BY a.id
       ORDER BY COUNT(b.id) DESC
       LIMIT 1`,
      [startDate, endDate]
    );

    res.json({
      success: true,
      overview: {
        total_auctions: auctionsData[0].total_auctions || 0,
        completed_auctions: auctionsData[0].completed_auctions || 0,
        total_users: usersData[0].total_users || 0,
        new_users: usersData[0].new_users || 0,
        total_revenue: revenueData[0].total_revenue || 0,
        avg_bid: revenueData[0].avg_bid || 0,
        participation_rate: participationData[0].participation_rate || 0,
        top_auction: topData[0]?.top_auction || 'N/A'
      }
    });
    
  } catch (error) {
    console.error('❌ Overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.getAuctionPerformanceReport = async (req, res) => {
  try {
    const { filter = 'this_month' } = req.query;

    let startDate, endDate;
    const now = moment();

    switch (filter) {
      case 'today':
        startDate = now.startOf('day').format('YYYY-MM-DD HH:mm:ss');
        endDate = now.endOf('day').format('YYYY-MM-DD HH:mm:ss');
        break;
      case 'this_week':
        startDate = now.startOf('week').format('YYYY-MM-DD HH:mm:ss');
        endDate = now.endOf('week').format('YYYY-MM-DD HH:mm:ss');
        break;
      case 'this_year':
        startDate = now.startOf('year').format('YYYY-MM-DD HH:mm:ss');
        endDate = now.endOf('year').format('YYYY-MM-DD HH:mm:ss');
        break;
      case 'this_month':
      default:
        startDate = now.startOf('month').format('YYYY-MM-DD HH:mm:ss');
        endDate = now.endOf('month').format('YYYY-MM-DD HH:mm:ss');
        break;
    }

    // Query auctions with details
    const [auctions] = await db.query(
      `SELECT 
         a.id,
         a.title,
         a.auction_date,
         a.base_price,
         a.current_price,
         a.status,
         u.person_name AS auctioneer_name,
         u.company_name AS auctioneer_company,
         (SELECT COUNT(*) FROM auction_participants ap WHERE ap.auction_id = a.id) AS participants,
         (SELECT COUNT(*) FROM bids b WHERE b.auction_id = a.id) AS total_bids,
         (SELECT SUM(amount) * 0.05 FROM bids b WHERE b.auction_id = a.id) AS revenue
       FROM auctions a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.created_at BETWEEN ? AND ?
       ORDER BY a.auction_date DESC`,
      [startDate, endDate]
    );

    // Format response
    const report = auctions.map(a => ({
      auction_details: {
        title: a.title,
        date: moment(a.auction_date).format('YYYY-MM-DD'),
      },
      auctioneer: {
        name: a.auctioneer_name,
        company: a.auctioneer_company
      },
      financial_data: {
        base: a.base_price,
        final: a.current_price || 'N/A',
        revenue: a.revenue || 0
      },
      participation: {
        participants: a.participants,
        total_bids: a.total_bids
      },
      status: a.status
    }));

    res.json({
      success: true,
      filter,
      report
    });

  } catch (error) {
    console.error('❌ Auction performance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.getUserActivityReport = async (req, res) => {
  try {
    const { filter } = req.query;

    let startDate, endDate;
    const today = moment().startOf('day');

    switch (filter) {
      case 'today':
        startDate = today.format('YYYY-MM-DD 00:00:00');
        endDate = today.format('YYYY-MM-DD 23:59:59');
        break;
      case 'this_week':
        startDate = today.startOf('week').format('YYYY-MM-DD 00:00:00');
        endDate = today.endOf('week').format('YYYY-MM-DD 23:59:59');
        break;
      case 'this_month':
        startDate = today.startOf('month').format('YYYY-MM-DD 00:00:00');
        endDate = today.endOf('month').format('YYYY-MM-DD 23:59:59');
        break;
      case 'this_year':
        startDate = today.startOf('year').format('YYYY-MM-DD 00:00:00');
        endDate = today.endOf('year').format('YYYY-MM-DD 23:59:59');
        break;
      default:
        startDate = '1970-01-01 00:00:00';
        endDate = moment().format('YYYY-MM-DD 23:59:59');
    }

    // Query users with their auction activity & financials
    const [users] = await db.query(
      `
      SELECT 
        u.id,
        u.person_name AS name,
        u.company_name AS company,
        u.email,
        CASE WHEN u.auctions_created > 0 THEN 'Auctioneer' ELSE 'Participant' END AS role,
        u.created_at AS registration_date,
        u.status,
        IFNULL(ua.total_auctions, 0) AS auctions,
        IFNULL(ua.total_bids, 0) AS bids,
        IFNULL(ua.total_wins, 0) AS wins,
        IFNULL(ua.total_won, 0) AS total_won,
        IFNULL(ua.avg_bid, 'N/A') AS avg_bid
      FROM users u
      LEFT JOIN (
        SELECT 
          a.created_by AS user_id,
          COUNT(a.id) AS total_auctions,
          COUNT(b.id) AS total_bids,
          SUM(CASE WHEN b.is_winning = 1 THEN 1 ELSE 0 END) AS total_wins,
          SUM(CASE WHEN b.is_winning = 1 THEN b.amount ELSE 0 END) AS total_won,
          AVG(CASE WHEN b.is_winning = 1 THEN b.amount ELSE NULL END) AS avg_bid
        FROM users u
        LEFT JOIN auctions a ON a.created_by = u.id AND a.created_at BETWEEN ? AND ?
        LEFT JOIN bids b ON b.user_id = u.id AND b.bid_time BETWEEN ? AND ?
        GROUP BY a.created_by
      ) ua ON ua.user_id = u.id
      WHERE u.created_at BETWEEN ? AND ?
      ORDER BY u.created_at DESC
      `,
      [startDate, endDate, startDate, endDate, startDate, endDate]
    );

    // Format response safely
    const report = users.map(u => ({
      user_details: {
        name: u.name,
        company: u.company,
        email: u.email
      },
      role_registration: {
        role: u.role,
        registration_date: moment(u.registration_date).format('YYYY-MM-DD')
      },
      auction_activity: {
        auctions: u.auctions,
        bids: u.bids,
        wins: u.wins ? u.wins.toString() : "0"
      },
      financial_data: {
        total_won: u.total_won ? Number(u.total_won).toFixed(2) : "0.00",
        avg_bid: u.avg_bid === 'N/A' || u.avg_bid === null ? 'N/A' : Number(u.avg_bid).toFixed(2)
      },
      status: u.status
    }));

    res.json({
      success: true,
      filter: filter || 'all_time',
      report
    });

  } catch (error) {
    console.error('❌ User Activity Report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};




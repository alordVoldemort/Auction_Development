const db = require('../db');
const moment = require('moment'); // make sure to install: npm install moment


exports.getOverview = async (req, res) => {
  try {
    const { filter = 'this_month' } = req.query;
    let startDate, endDate;
    const now = moment();

    /* ----------  existing date-window switch  ---------- */
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

    /* ----------  existing KPI queries  ---------- */
    const [auctionsData] = await db.query(
      `SELECT
          COUNT(*) AS total_auctions,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_auctions
       FROM auctions
       WHERE created_at BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    const [usersData] = await db.query(
      `SELECT
          COUNT(*) AS total_users,
          SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS new_users
       FROM users`,
      [startDate, endDate]
    );

    const [revenueData] = await db.query(
      `SELECT
          SUM(b.amount) AS total_revenue,
          AVG(b.amount) AS avg_bid
       FROM bids b
       LEFT JOIN auctions a ON b.auction_id = a.id
       WHERE a.created_at BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    const [participationData] = await db.query(
      `SELECT
          ROUND(SUM(CASE WHEN ap.status='joined' THEN 1 ELSE 0 END) /
                SUM(1) * 100, 2) AS participation_rate
       FROM auction_participants ap
       LEFT JOIN auctions a ON ap.auction_id = a.id
       WHERE a.created_at BETWEEN ? AND ?`,
      [startDate, endDate]
    );

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

    /* ----------  CORRECT monthly trends  ---------- */
    const [trendRows] = await db.query(
      `SELECT
         DATE_FORMAT(a.created_at, '%b %Y')      AS month,
         COUNT(DISTINCT a.id)                    AS auction_count,
         COALESCE(ROUND(SUM(b.amount)), 0)       AS revenue
       FROM auctions a
       LEFT JOIN bids b ON b.auction_id = a.id
       GROUP BY DATE_FORMAT(a.created_at, '%Y-%m')
       ORDER BY DATE_FORMAT(a.created_at, '%Y-%m')`
    );

    /* ----------  final payload  ---------- */
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
        top_auction: topData[0]?.top_auction || '—',
        monthly_trends: trendRows
      }
    });

  } catch (error) {
    console.error('❌ Overview error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.getAuctionPerformanceReport = async (req, res) => {
  try {
    const { filter = 'this_month' } = req.query;

    /* ----------  date window  ---------- */
    const now = moment();
    const fmt = 'YYYY-MM-DD HH:mm:ss';
    let startDate, endDate;

    switch (filter) {
      case 'today':
        startDate = now.startOf('day').format(fmt);
        endDate   = now.endOf('day').format(fmt);
        break;
      case 'this_week':
        startDate = now.startOf('week').format(fmt);
        endDate   = now.endOf('week').format(fmt);
        break;
      case 'this_year':
        startDate = now.startOf('year').format(fmt);
        endDate   = now.endOf('year').format(fmt);
        break;
      case 'this_month':
      default:
        startDate = now.startOf('month').format(fmt);
        endDate   = now.endOf('month').format(fmt);
        break;
    }

    /* ----------  main query  ---------- */
    const sql = `
      SELECT
        a.id,
        a.title,
        a.auction_date,
        a.current_price,
        a.status,
        u.person_name AS auctioneer_name,
        u.company_name AS auctioneer_company,
        COALESCE(p.cnt, 0) AS participants,
        COALESCE(b.cnt, 0) AS total_bids,
        COALESCE(b.tot, 0) * 0.05 AS revenue
      FROM auctions AS a
      LEFT JOIN users AS u ON u.id = a.created_by
      LEFT JOIN (
          SELECT auction_id, COUNT(*) AS cnt
          FROM auction_participants
          GROUP BY auction_id
      ) AS p ON p.auction_id = a.id
      LEFT JOIN (
          SELECT auction_id, COUNT(*) AS cnt, SUM(amount) AS tot
          FROM bids
          GROUP BY auction_id
      ) AS b ON b.auction_id = a.id
      WHERE a.created_at BETWEEN ? AND ?
      ORDER BY a.auction_date DESC`;

    const [rows] = await db.query(sql, [startDate, endDate]);

    /* ----------  shape rows for UI  ---------- */
    const report = rows.map(r => ({
      auction_details: {
        title: r.title,
        date: moment(r.auction_date).format('YYYY-MM-DD')
      },
      auctioneer: {
        name: r.auctioneer_name,
        company: r.auctioneer_company
      },
      participation: {
        participants: r.participants,
        total_bids: r.total_bids
      },
      financial_data: {
        final: Number(r.current_price || 0),
        revenue: Math.round(r.revenue || 0)
      },
      status: r.status
    }));

    /* ----------  optional totals  ---------- */
    const summary = {
      total_auctions: rows.length,
      total_revenue: Math.round(rows.reduce((s, r) => s + (r.revenue || 0), 0)),
      avg_participants: rows.length
        ? (rows.reduce((s, r) => s + r.participants, 0) / rows.length).toFixed(1)
        : 0
    };

    res.json({ success: true, filter, summary, report });

  } catch (error) {
    console.error('❌ Auction performance report error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// User Activity Report with filtering - FIXED VERSION
exports.getUserActivityReport = async (req, res) => {
  try {
    const { period = 'this_month' } = req.query;
    const now = moment();
    const fmt = 'YYYY-MM-DD HH:mm:ss';
    let startDate, endDate;

    switch (period) {
      case 'today':
        startDate = now.startOf('day').format(fmt);
        endDate   = now.endOf('day').format(fmt);
        break;
      case 'this_week':
        startDate = now.startOf('week').format(fmt);
        endDate   = now.endOf('week').format(fmt);
        break;
      case 'this_year':
        startDate = now.startOf('year').format(fmt);
        endDate   = now.endOf('year').format(fmt);
        break;
      case 'this_month':
      default:
        startDate = now.startOf('month').format(fmt);
        endDate   = now.endOf('month').format(fmt);
        break;
    }

    /* ----------  one query – everything inside the period  ---------- */
    const sql = `
      SELECT
        u.id,
        u.person_name                                    AS name,
        u.company_name                                   AS company,
        u.created_at                                     AS registration_date,
        /* ------ role ------ */
        CASE
          WHEN COUNT(DISTINCT CASE WHEN a.created_at BETWEEN ? AND ? THEN a.id END) > 0
               AND COUNT(DISTINCT CASE WHEN b.bid_time BETWEEN ? AND ? THEN b.id END) > 0
          THEN 'Both'
          WHEN COUNT(DISTINCT CASE WHEN a.created_at BETWEEN ? AND ? THEN a.id END) > 0
          THEN 'Auctioneer'
          WHEN COUNT(DISTINCT CASE WHEN b.bid_time BETWEEN ? AND ? THEN b.id END) > 0
          THEN 'Participant'
          ELSE 'Inactive'
        END                                              AS user_role,
        /* ------ activity counts ------ */
        COUNT(DISTINCT CASE WHEN a.created_at BETWEEN ? AND ? THEN a.id END) AS auctions_created,
        COUNT(DISTINCT CASE WHEN b.bid_time   BETWEEN ? AND ? THEN b.id END) AS bids_placed,
        SUM(CASE WHEN b.is_winning = 1 AND b.bid_time BETWEEN ? AND ? THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN b.is_winning = 1 AND b.bid_time BETWEEN ? AND ? THEN b.amount ELSE 0 END) AS total_revenue,
        AVG(CASE WHEN b.is_winning = 1 AND b.bid_time BETWEEN ? AND ? THEN b.amount ELSE NULL END) AS avg_win_amount,
        /* ------ auction status breakdown (only for auctions created in period) ------ */
        SUM(CASE WHEN a.created_at BETWEEN ? AND ? AND a.status = 'live'      THEN 1 ELSE 0 END) AS live_count,
        SUM(CASE WHEN a.created_at BETWEEN ? AND ? AND a.status = 'upcoming'  THEN 1 ELSE 0 END) AS upcoming_count,
        SUM(CASE WHEN a.created_at BETWEEN ? AND ? AND a.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        /* ------ dynamic user status ------ */
        IF(
          COUNT(DISTINCT CASE WHEN a.created_at BETWEEN ? AND ? THEN a.id END) +
          COUNT(DISTINCT CASE WHEN b.bid_time   BETWEEN ? AND ? THEN b.id END) = 0,
          'inactive',
          'active'
        )                                                AS user_status
      FROM users u
      LEFT JOIN auctions a ON a.created_by = u.id
      LEFT JOIN bids b     ON b.user_id    = u.id
      GROUP BY u.id
      ORDER BY u.person_name`;

    const [users] = await db.query(sql, [
      /* role + activity  */
      startDate, endDate,  /* a */
      startDate, endDate,  /* b */
      startDate, endDate,  /* a */
      startDate, endDate,  /* b */
      /* auctions_created */
      startDate, endDate,
      /* bids_placed */
      startDate, endDate,
      /* wins */
      startDate, endDate,
      /* total_revenue */
      startDate, endDate,
      /* avg_win_amount */
      startDate, endDate,
      /* live / upcoming / completed */
      startDate, endDate,
      startDate, endDate,
      startDate, endDate,
      /* user_status */
      startDate, endDate,
      startDate, endDate
    ]);

    /* ----------  shape payload  ---------- */
    const userActivityReport = users.map(u => ({
      user_details: {
        name: u.name,
        company: u.company
      },
      role_registration: {
        role: "User",
        registration_date: moment(u.registration_date).format('M/D/YYYY')
      },
      auction_activity: {
        auctions: u.auctions_created,
        bids: u.bids_placed,
        wins: u.wins || 0,
        /* NEW: per-status counts inside the period */
        live: u.live_count,
        upcoming: u.upcoming_count,
        completed: u.completed_count
      },
      financial_data: u.total_revenue > 0
        ? {
            total: `₹${Math.round(u.total_revenue).toLocaleString('en-IN')}`,
            average: `₹${Math.round(u.avg_win_amount || 0).toLocaleString('en-IN')}`
          }
        : 'N/A',
      status: u.user_status /* 'active' | 'inactive' */
    }));

    res.json({
      success: true,
      period,
      startDate,
      endDate,
      total_users: users.length,
      user_activity_report: userActivityReport
    });

  } catch (error) {
    console.error('❌ User activity report error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// // Revenue Analytics API
// exports.getRevenueAnalytics = async (req, res) => {
//   try {
//     const { period = 'this_month' } = req.query;

//     let startDate, endDate;
//     const now = moment();

//     switch (period) {
//       case 'today':
//         startDate = now.startOf('day').format('YYYY-MM-DD HH:mm:ss');
//         endDate = now.endOf('day').format('YYYY-MM-DD HH:mm:ss');
//         break;
//       case 'this_week':
//         startDate = now.startOf('week').format('YYYY-MM-DD HH:mm:ss');
//         endDate = now.endOf('week').format('YYYY-MM-DD HH:mm:ss');
//         break;
//       case 'this_year':
//         startDate = now.startOf('year').format('YYYY-MM-DD HH:mm:ss');
//         endDate = now.endOf('year').format('YYYY-MM-DD HH:mm:ss');
//         break;
//       case 'this_month':
//       default:
//         startDate = now.startOf('month').format('YYYY-MM-DD HH:mm:ss');
//         endDate = now.endOf('month').format('YYYY-MM-DD HH:mm:ss');
//         break;
//     }

//     // Current period revenue data
//     const [currentRevenue] = await db.query(
//       `SELECT 
//         SUM(b.amount) as total_revenue,
//         COUNT(b.id) as total_transactions,
//         AVG(b.amount) as avg_transaction,
//         SUM(b.amount) * 0.05 as commission_earned,
//         COUNT(DISTINCT a.id) as total_auctions
//       FROM bids b
//       INNER JOIN auctions a ON b.auction_id = a.id
//       WHERE b.is_winning = 1 
//         AND b.bid_time BETWEEN ? AND ?`,
//       [startDate, endDate]
//     );

//     // Previous period data for comparison (e.g., last month)
//     const prevStartDate = moment(startDate).subtract(1, 'month').format('YYYY-MM-DD HH:mm:ss');
//     const prevEndDate = moment(endDate).subtract(1, 'month').format('YYYY-MM-DD HH:mm:ss');

//     const [previousRevenue] = await db.query(
//       `SELECT 
//         SUM(b.amount) as total_revenue,
//         COUNT(b.id) as total_transactions,
//         AVG(b.amount) as avg_transaction,
//         SUM(b.amount) * 0.05 as commission_earned
//       FROM bids b
//       INNER JOIN auctions a ON b.auction_id = a.id
//       WHERE b.is_winning = 1 
//         AND b.bid_time BETWEEN ? AND ?`,
//       [prevStartDate, prevEndDate]
//     );

//     // Calculate percentage changes
//     const calculatePercentageChange = (current, previous) => {
//       if (!previous || previous === 0) return 0;
//       return ((current - previous) / previous) * 100;
//     };

//     const totalRevenue = currentRevenue[0].total_revenue || 0;
//     const prevTotalRevenue = previousRevenue[0].total_revenue || 0;
//     const revenueChange = calculatePercentageChange(totalRevenue, prevTotalRevenue);

//     const avgTransaction = currentRevenue[0].avg_transaction || 0;
//     const prevAvgTransaction = previousRevenue[0].avg_transaction || 0;
//     const avgTransactionChange = calculatePercentageChange(avgTransaction, prevAvgTransaction);

//     const commission = currentRevenue[0].commission_earned || 0;
//     const prevCommission = previousRevenue[0].commission_earned || 0;
//     const commissionChange = calculatePercentageChange(commission, prevCommission);

//     // Revenue by month (last 6 months)
//     const months = [];
//     for (let i = 5; i >= 0; i--) {
//       const monthDate = moment().subtract(i, 'months');
//       months.push(monthDate.format('YYYY-MM'));
//     }

//     const [monthlyRevenue] = await db.query(
//       `SELECT 
//         DATE_FORMAT(b.bid_time, '%Y-%m') as month,
//         SUM(b.amount) as revenue,
//         COUNT(DISTINCT a.id) as auctions_count
//       FROM bids b
//       INNER JOIN auctions a ON b.auction_id = a.id
//       WHERE b.is_winning = 1 
//         AND DATE_FORMAT(b.bid_time, '%Y-%m') IN (?)
//       GROUP BY DATE_FORMAT(b.bid_time, '%Y-%m')
//       ORDER BY month`,
//       [months]
//     );

//     // Format monthly revenue data
//     const revenueByMonth = months.map(month => {
//       const monthData = monthlyRevenue.find(m => m.month === month);
//       const monthName = moment(month, 'YYYY-MM').format('MMM YYYY');
      
//       return {
//         month: monthName,
//         revenue: monthData ? monthData.revenue : 0,
//         auctions: monthData ? monthData.auctions_count : 0
//       };
//     });

//     // Top performing auctions
//     const [topAuctions] = await db.query(
//       `SELECT 
//         a.title,
//         a.id,
//         MAX(b.amount) as winning_bid,
//         u.person_name as winner_name,
//         u.company_name as winner_company
//       FROM auctions a
//       INNER JOIN bids b ON a.id = b.auction_id AND b.is_winning = 1
//       INNER JOIN users u ON b.user_id = u.id
//       WHERE b.bid_time BETWEEN ? AND ?
//       GROUP BY a.id
//       ORDER BY winning_bid DESC
//       LIMIT 5`,
//       [startDate, endDate]
//     );

//     res.json({
//       success: true,
//       period,
//       startDate,
//       endDate,
//       revenue_summary: {
//         total_revenue: {
//           amount: totalRevenue,
//           formatted: `₹${(totalRevenue || 0).toLocaleString('en-IN')}`,
//           change_percentage: Math.round(revenueChange),
//           trend: revenueChange >= 0 ? 'up' : 'down'
//         },
//         average_transaction: {
//           amount: avgTransaction,
//           formatted: `₹${(avgTransaction || 0).toLocaleString('en-IN')}`,
//           change_percentage: Math.round(avgTransactionChange),
//           trend: avgTransactionChange >= 0 ? 'up' : 'down'
//         },
//         commission_earned: {
//           amount: commission,
//           formatted: `₹${(commission || 0).toLocaleString('en-IN')}`,
//           change_percentage: Math.round(commissionChange),
//           trend: commissionChange >= 0 ? 'up' : 'down'
//         },
//         total_auctions: currentRevenue[0].total_auctions || 0
//       },
//       revenue_by_month: revenueByMonth.map(month => ({
//         month: month.month,
//         revenue: month.revenue,
//         formatted_revenue: `₹${(month.revenue || 0).toLocaleString('en-IN')}`,
//         auctions: month.auctions,
//         formatted_auctions: `${month.auctions} Auctions`
//       })),
//       top_performing_auctions: topAuctions.map(auction => ({
//         title: auction.title,
//         winning_bid: auction.winning_bid,
//         formatted_bid: `₹${(auction.winning_bid || 0).toLocaleString('en-IN')}`,
//         winner: `${auction.winner_name} - ${auction.winner_company}`
//       })),
//       comparison: {
//         current_period: {
//           start: startDate,
//           end: endDate
//         },
//         previous_period: {
//           start: prevStartDate,
//           end: prevEndDate
//         }
//       }
//     });

//   } catch (error) {
//     console.error('❌ Revenue analytics error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

// // Get revenue data for specific time range
// exports.getRevenueByDateRange = async (req, res) => {
//   try {
//     const { start_date, end_date } = req.query;

//     if (!start_date || !end_date) {
//       return res.status(400).json({
//         success: false,
//         message: 'Start date and end date are required'
//       });
//     }

//     const [revenueData] = await db.query(
//       `SELECT 
//         SUM(b.amount) as total_revenue,
//         COUNT(b.id) as total_transactions,
//         AVG(b.amount) as avg_transaction,
//         SUM(b.amount) * 0.05 as commission_earned,
//         COUNT(DISTINCT a.id) as total_auctions,
//         COUNT(DISTINCT b.user_id) as unique_bidders
//       FROM bids b
//       INNER JOIN auctions a ON b.auction_id = a.id
//       WHERE b.is_winning = 1 
//         AND b.bid_time BETWEEN ? AND ?`,
//       [start_date, end_date]
//     );

//     res.json({
//       success: true,
//       date_range: {
//         start: start_date,
//         end: end_date
//       },
//       revenue_data: {
//         total_revenue: revenueData[0].total_revenue || 0,
//         formatted_revenue: `₹${(revenueData[0].total_revenue || 0).toLocaleString('en-IN')}`,
//         total_transactions: revenueData[0].total_transactions || 0,
//         average_transaction: revenueData[0].avg_transaction || 0,
//         formatted_avg_transaction: `₹${(revenueData[0].avg_transaction || 0).toLocaleString('en-IN')}`,
//         commission_earned: revenueData[0].commission_earned || 0,
//         formatted_commission: `₹${(revenueData[0].commission_earned || 0).toLocaleString('en-IN')}`,
//         total_auctions: revenueData[0].total_auctions || 0,
//         unique_bidders: revenueData[0].unique_bidders || 0
//       }
//     });

//   } catch (error) {
//     console.error('❌ Revenue by date range error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };


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

// User Activity Report with filtering - FIXED VERSION
exports.getUserActivityReport = async (req, res) => {
  try {
    const { period = 'this_month' } = req.query;

    let startDate, endDate;
    const now = moment();

    switch (period) {
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

    console.log('Querying period:', period, 'from', startDate, 'to', endDate);

    // Get user activity data - FIXED query
    const [users] = await db.query(
      `SELECT 
          u.id,
          u.person_name as name,
          u.company_name as company,
          u.created_at as registration_date,
          u.status,
          -- Count auctions created by this user in the period
          COUNT(DISTINCT CASE WHEN a.created_at BETWEEN ? AND ? THEN a.id END) as auctions_created,
          -- Count bids placed by this user in the period
          COUNT(DISTINCT CASE WHEN b.bid_time BETWEEN ? AND ? THEN b.id END) as bids_placed,
          -- Count winning bids by this user in the period
          SUM(CASE WHEN b.is_winning = 1 AND b.bid_time BETWEEN ? AND ? THEN 1 ELSE 0 END) as wins,
          -- Sum of winning bid amounts in the period
          SUM(CASE WHEN b.is_winning = 1 AND b.bid_time BETWEEN ? AND ? THEN b.amount ELSE 0 END) as total_revenue,
          -- Average of winning bid amounts in the period
          AVG(CASE WHEN b.is_winning = 1 AND b.bid_time BETWEEN ? AND ? THEN b.amount ELSE NULL END) as avg_win_amount,
          -- Determine role based on activity
          CASE 
            WHEN COUNT(DISTINCT CASE WHEN a.created_at BETWEEN ? AND ? THEN a.id END) > 0 
                 AND COUNT(DISTINCT CASE WHEN b.bid_time BETWEEN ? AND ? THEN b.id END) > 0 THEN 'Both'
            WHEN COUNT(DISTINCT CASE WHEN a.created_at BETWEEN ? AND ? THEN a.id END) > 0 THEN 'Auctioneer'
            WHEN COUNT(DISTINCT CASE WHEN b.bid_time BETWEEN ? AND ? THEN b.id END) > 0 THEN 'Participant'
            ELSE 'Inactive'
          END as user_role
      FROM users u
      LEFT JOIN auctions a ON u.id = a.created_by
      LEFT JOIN bids b ON u.id = b.user_id
      GROUP BY u.id
      ORDER BY u.person_name`,
      [
        // For auctions_created
        startDate, endDate,
        // For bids_placed
        startDate, endDate,
        // For wins
        startDate, endDate,
        // For total_revenue
        startDate, endDate,
        // For avg_win_amount
        startDate, endDate,
        // For role determination (auctions)
        startDate, endDate,
        // For role determination (bids)
        startDate, endDate,
        // For role determination (auctions again)
        startDate, endDate,
        // For role determination (bids again)
        startDate, endDate
      ]
    );

    console.log('Found users:', users.length);

    // Format the response to match your table structure
    const userActivityReport = users.map(user => {
      console.log('Processing user:', user.name, {
        auctions: user.auctions_created,
        bids: user.bids_placed,
        wins: user.wins,
        revenue: user.total_revenue,
        avg: user.avg_win_amount
      });

      const financialData = user.total_revenue > 0 ? {
        total: `₹${Math.round(user.total_revenue).toLocaleString('en-IN')}`,
        average: `₹${user.avg_win_amount ? Math.round(user.avg_win_amount).toLocaleString('en-IN') : '0'}`
      } : 'N/A';

      return {
        user_details: {
          name: user.name,
          company: user.company
        },
        role_registration: {
          role: user.user_role,
          registration_date: moment(user.registration_date).format('M/D/YYYY')
        },
        auction_activity: {
          auctions: user.auctions_created,
          bids: user.bids_placed,
          wins: user.wins || 0  // Ensure wins is a number, not string
        },
        financial_data: financialData,
        status: user.status
      };
    });

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
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
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


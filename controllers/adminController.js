const db = require('../db');

// Get Admin Dashboard Overview - COMPREHENSIVE VERSION
exports.getAdminDashboard = async (req, res) => {
  try {
    // Get all dashboard stats in parallel
    const [
      totalUsers,
      totalAuctions,
      upcomingAuctions,
      liveAuctions,
      completedAuctions,
      cancelledAuctions,
      totalBids,
      recentUsers,
      recentAuctions,
      totalParticipants,
      pendingUsers,
      pendingAuctions
    ] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM users'),
      db.query('SELECT COUNT(*) as count FROM auctions'),
      db.query('SELECT COUNT(*) as count FROM auctions WHERE status = "upcoming"'),
      db.query('SELECT COUNT(*) as count FROM auctions WHERE status = "live"'),
      db.query('SELECT COUNT(*) as count FROM auctions WHERE status = "completed"'),
      db.query('SELECT COUNT(*) as count FROM auctions WHERE status = "cancelled"'),
      db.query('SELECT COUNT(*) as count FROM bids'),
      db.query('SELECT COUNT(*) as count FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'),
      db.query('SELECT COUNT(*) as count FROM auctions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'),
      db.query('SELECT COUNT(*) as count FROM auction_participants'),
      db.query('SELECT COUNT(*) as count FROM users WHERE is_approved = FALSE OR is_approved IS NULL'),
      db.query('SELECT COUNT(*) as count FROM auctions WHERE status = "pending" OR status IS NULL')
    ]);

    // Get recent activities
    const [recentActivities] = await db.query(`
      (
        SELECT 
          'auction_created' as type,
          a.id,
          a.title,
          a.status,
          a.created_at as timestamp,
          NULL as amount,
          u.company_name,
          u.person_name,
          NULL as phone_number,
          NULL as winner_company,
          NULL as auctioneer_action
        FROM auctions a
        JOIN users u ON a.created_by = u.id
        ORDER BY a.created_at DESC 
        LIMIT 10
      )
      UNION ALL
      (
        SELECT 
          'user_registered' as type,
          u.id,
          NULL as title,
          NULL as status,
          u.created_at as timestamp,
          NULL as amount,
          u.company_name,
          u.person_name,
          u.phone_number,
          NULL as winner_company,
          NULL as auctioneer_action
        FROM users u
        ORDER BY u.created_at DESC 
        LIMIT 10
      )
      UNION ALL
      (
        SELECT 
          'auction_completed' as type,
          a.id,
          a.title,
          a.status,
          a.updated_at as timestamp,
          a.current_price as amount,
          NULL as company_name,
          NULL as person_name,
          NULL as phone_number,
          winner.company_name as winner_company,
          NULL as auctioneer_action
        FROM auctions a
        LEFT JOIN (
          SELECT b.auction_id, u.company_name 
          FROM bids b 
          JOIN users u ON b.user_id = u.id 
          WHERE b.is_winning = TRUE
        ) winner ON a.id = winner.auction_id
        WHERE a.status = 'completed'
        ORDER BY a.updated_at DESC 
        LIMIT 10
      )
      UNION ALL
      (
        SELECT 
          'user_approved' as type,
          u.id,
          NULL as title,
          NULL as status,
          u.updated_at as timestamp,
          NULL as amount,
          u.company_name,
          u.person_name,
          u.phone_number,
          NULL as winner_company,
          'approved' as auctioneer_action
        FROM users u
        WHERE u.is_approved = TRUE
        ORDER BY u.updated_at DESC 
        LIMIT 10
      )
      UNION ALL
      (
        SELECT 
          'auction_cancelled' as type,
          a.id,
          a.title,
          a.status,
          a.updated_at as timestamp,
          NULL as amount,
          u.company_name,
          u.person_name,
          NULL as phone_number,
          NULL as winner_company,
          'cancelled' as auctioneer_action
        FROM auctions a
        JOIN users u ON a.created_by = u.id
        WHERE a.status = 'cancelled'
        ORDER BY a.updated_at DESC 
        LIMIT 10
      )
      ORDER BY timestamp DESC 
      LIMIT 15
    `);

    // Format recent activities with human-readable messages and time
    const formattedActivities = recentActivities.map(activity => {
      const timestamp = new Date(activity.timestamp);
      const now = new Date();
      const diffMs = now - timestamp;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      
      let timeAgo;
      if (diffMins < 1) timeAgo = 'Just now';
      else if (diffMins < 60) timeAgo = `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
      else if (diffHours < 24) timeAgo = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
      else timeAgo = `${Math.floor(diffHours / 24)} day${Math.floor(diffHours / 24) !== 1 ? 's' : ''} ago`;

      let message = '';
      let icon = '';

      switch (activity.type) {
        case 'auction_created':
          message = `New auction "${activity.title}" created by ${activity.company_name}`;
          icon = '📊';
          break;
        case 'user_registered':
          message = `New user registration: ${activity.company_name} (Phone: ${activity.phone_number})`;
          icon = '👤';
          break;
        case 'auction_completed':
          message = `Auction "${activity.title}" completed with winning bid ₹${activity.amount?.toLocaleString('en-IN') || 'N/A'} by ${activity.winner_company || 'Unknown'}`;
          icon = '✅';
          break;
        case 'user_approved':
          message = `User "${activity.company_name}" approved for participation`;
          icon = '👍';
          break;
        case 'auction_cancelled':
          message = `Auction "${activity.title}" cancelled by auctioneer`;
          icon = '❌';
          break;
        default:
          message = 'Unknown activity';
          icon = 'ℹ️';
      }

      return {
        ...activity,
        message,
        icon,
        time_ago: timeAgo,
        formatted_time: timestamp.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
    });

    // Get upcoming auctions with participant counts
    const [upcomingAuctionsList] = await db.query(`
      SELECT 
        a.id,
        a.title,
        a.auction_date,
        a.start_time,
        a.currency,
        u.company_name as creator_company,
        COUNT(ap.id) as participant_count
      FROM auctions a
      JOIN users u ON a.created_by = u.id
      LEFT JOIN auction_participants ap ON a.id = ap.auction_id
      WHERE a.status = 'upcoming'
      GROUP BY a.id
      ORDER BY a.auction_date, a.start_time
      LIMIT 5
    `);

    // Format upcoming auctions
    const formattedUpcomingAuctions = upcomingAuctionsList.map(auction => ({
      id: auction.id,
      title: auction.title,
      participant_count: auction.participant_count,
      company: auction.creator_company,
      start_time: new Date(`${auction.auction_date}T${auction.start_time}`).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }),
      auction_no: `AUC${auction.id.toString().padStart(3, '0')}`
    }));

    // Quick actions data
    const quickActions = [
      {
        id: 1,
        title: 'Approve Pending Users',
        description: `${pendingUsers[0][0].count} users awaiting approval`,
        icon: '👥',
        action: 'user_approval',
        count: pendingUsers[0][0].count
      },
      {
        id: 2,
        title: 'Review Auction Requests',
        description: `${pendingAuctions[0][0].count} auctions pending review`,
        icon: '📋',
        action: 'auction_review',
        count: pendingAuctions[0][0].count
      },
      {
        id: 3,
        title: 'Generate Reports',
        description: 'Download system reports and analytics',
        icon: '📊',
        action: 'generate_reports',
        count: 0
      },
      {
        id: 4,
        title: 'Manage Users',
        description: 'View and manage all system users',
        icon: '⚙️',
        action: 'manage_users',
        count: totalUsers[0][0].count
      }
    ];

    res.json({
      success: true,
      dashboard: {
        overview: {
          total_users: totalUsers[0][0].count,
          total_auctions: totalAuctions[0][0].count,
          upcoming_auctions: upcomingAuctions[0][0].count,
          live_auctions: liveAuctions[0][0].count,
          completed_auctions: completedAuctions[0][0].count,
          cancelled_auctions: cancelledAuctions[0][0].count || 0,
          total_bids: totalBids[0][0].count,
          total_participants: totalParticipants[0][0].count,
          new_users_7d: recentUsers[0][0].count,
          new_auctions_7d: recentAuctions[0][0].count,
          pending_users: pendingUsers[0][0].count,
          pending_auctions: pendingAuctions[0][0].count
        },
        recent_activities: formattedActivities,
        upcoming_auctions: formattedUpcomingAuctions,
        quick_actions: quickActions
      }
    });

  } catch (error) {
    console.error('❌ Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const db = require('../db');

// Get all users with filters
exports.getAllUsers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '', 
      status = '',
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    const validSortColumns = ['created_at', 'company_name', 'updated_at', 'person_name'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let query = `
      SELECT 
        u.*,
        COUNT(DISTINCT a.id) as auctions_created,
        COUNT(DISTINCT b.id) as bids_placed,
        MAX(b.bid_time) as last_activity,
        CASE 
          WHEN u.is_active = 0 THEN 'inactive'
          WHEN u.is_approved IS NULL OR u.is_approved = 0 THEN 'pending'
          WHEN u.is_approved = 1 AND u.is_active = 1 THEN 'active'
          ELSE 'unknown'
        END as status
      FROM users u
      LEFT JOIN auctions a ON u.id = a.created_by
      LEFT JOIN bids b ON u.id = b.user_id
      WHERE 1=1
    `;

    let countQuery = 'SELECT COUNT(*) as total FROM users u WHERE 1=1';
    const params = [];
    const countParams = [];

    // Status filter
    if (status) {
      switch (status) {
        case 'active':
          query += ' AND u.is_active = 1 AND u.is_approved = 1';
          countQuery += ' AND u.is_active = 1 AND u.is_approved = 1';
          break;
        case 'inactive':
          query += ' AND u.is_active = 0';
          countQuery += ' AND u.is_active = 0';
          break;
        case 'pending':
          query += ' AND (u.is_approved IS NULL OR u.is_approved = 0) AND u.is_active = 1';
          countQuery += ' AND (u.is_approved IS NULL OR u.is_approved = 0) AND u.is_active = 1';
          break;
        case 'approved':
          query += ' AND u.is_approved = 1';
          countQuery += ' AND u.is_approved = 1';
          break;
        case 'rejected':
          query += ' AND u.is_approved = 0 AND u.is_active = 0'; // FIXED: Rejected should be inactive
          countQuery += ' AND u.is_approved = 0 AND u.is_active = 0';
          break;
      }
    }

    // Search filter
    if (search) {
      query += ' AND (u.company_name LIKE ? OR u.person_name LIKE ? OR u.email LIKE ? OR u.phone_number LIKE ?)';
      countQuery += ' AND (u.company_name LIKE ? OR u.person_name LIKE ? OR u.email LIKE ? OR u.phone_number LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam);
      countParams.push(searchParam, searchParam, searchParam, searchParam);
    }

    query += `
      GROUP BY u.id
      ORDER BY ${sortColumn} ${order}
      LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit), offset);

    const [users] = await db.query(query, params);
    const [totalResult] = await db.query(countQuery, countParams);
    const total = totalResult[0].total;

    // Get status counts for filters - FIXED
    const [statusCounts] = await db.query(`
      SELECT 
        SUM(CASE WHEN is_active = 1 AND is_approved = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive,
        SUM(CASE WHEN (is_approved IS NULL OR is_approved = 0) AND is_active = 1 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN is_approved = 1 THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN is_approved = 0 AND is_active = 0 THEN 1 ELSE 0 END) as rejected  -- FIXED: Only count inactive rejected users
      FROM users
    `);

    // Convert counts to numbers (better for frontend)
    const statusCountsFormatted = {
      active: Number(statusCounts[0].active),
      inactive: Number(statusCounts[0].inactive),
      pending: Number(statusCounts[0].pending),
      approved: Number(statusCounts[0].approved),
      rejected: Number(statusCounts[0].rejected)
    };

    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      filters: {
        status_counts: statusCountsFormatted
      }
    });

  } catch (error) {
    console.error('❌ Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const [users] = await db.query(`
      SELECT 
        u.*,
        COUNT(DISTINCT a.id) as auctions_created,
        COUNT(DISTINCT b.id) as total_bids,
        COUNT(DISTINCT CASE WHEN b.is_winning = TRUE THEN a.id END) as auctions_won,
        MAX(b.bid_time) as last_activity
      FROM users u
      LEFT JOIN auctions a ON u.id = a.created_by
      LEFT JOIN bids b ON u.id = b.user_id
      WHERE u.id = ?
      GROUP BY u.id
    `, [id]);

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Get recent activity
    const [recentActivity] = await db.query(`
      (
        SELECT 
          'bid_placed' as type,
          a.title as auction_title,
          b.amount,
          b.bid_time as timestamp,
          NULL as description
        FROM bids b
        JOIN auctions a ON b.auction_id = a.id
        WHERE b.user_id = ?
        ORDER BY b.bid_time DESC
        LIMIT 5
      )
      UNION ALL
      (
        SELECT 
          'auction_created' as type,
          a.title as auction_title,
          NULL as amount,
          a.created_at as timestamp,
          a.description
        FROM auctions a
        WHERE a.created_by = ?
        ORDER BY a.created_at DESC
        LIMIT 5
      )
      ORDER BY timestamp DESC
      LIMIT 10
    `, [id, id]);

    // Format recent activity with human-readable time
    const formattedActivity = recentActivity.map(activity => {
      const timestamp = new Date(activity.timestamp);
      const now = new Date();
      const diffMs = now - timestamp;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      
      let timeAgo;
      if (diffMins < 1) timeAgo = 'Just now';
      else if (diffMins < 60) timeAgo = `${diffMins}m ago`;
      else if (diffHours < 24) timeAgo = `${diffHours}h ago`;
      else timeAgo = `${Math.floor(diffHours / 24)}d ago`;

      return {
        ...activity,
        time_ago: timeAgo
      };
    });

    // Calculate participation rate
    const totalAuctions = await db.query('SELECT COUNT(*) as count FROM auctions WHERE status = "completed"');
    const participationRate = totalAuctions[0][0].count > 0 
      ? `${Math.round((user.auctions_created + user.total_bids) / totalAuctions[0][0].count * 100)}%`
      : '0%';

    res.json({
      success: true,
      user: {
        ...user,
        statistics: {
          auctions_created: user.auctions_created,
          auctions_won: user.auctions_won,
          total_bids: user.total_bids,
          active_bids: user.total_bids - user.auctions_won,
          participation_rate: participationRate
        },
        recent_activity: formattedActivity
      }
    });

  } catch (error) {
    console.error('❌ Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update user status
exports.updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, is_approved, status_note } = req.body;

    // Check if user exists
    const [user] = await db.query('SELECT id FROM users WHERE id = ?', [id]);
    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updateFields = [];
    const updateParams = [];

    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      updateParams.push(is_active);
    }

    if (is_approved !== undefined) {
      updateFields.push('is_approved = ?');
      updateParams.push(is_approved);
    }

    // Check if status_note column exists before trying to update it
    // Remove or comment out this block if column doesn't exist
    /*
    if (status_note) {
      updateFields.push('status_note = ?');
      updateParams.push(status_note);
    }
    */

    updateFields.push('updated_at = NOW()');
    updateParams.push(id);

    const [result] = await db.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated user - remove status_note from SELECT if column doesn't exist
    const [updatedUser] = await db.query(
      'SELECT id, is_active, is_approved, updated_at FROM users WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'User status updated successfully',
      user: updatedUser[0]
    });

  } catch (error) {
    console.error('❌ Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete user
// exports.deleteUser = async (req, res) => {
//   try {
//     const { id } = req.params;

//     // Start transaction
//     await db.query('START TRANSACTION');

//     try {
//       // Check if user exists
//       const [user] = await db.query('SELECT id FROM users WHERE id = ?', [id]);
//       if (user.length === 0) {
//         await db.query('ROLLBACK');
//         return res.status(404).json({
//           success: false,
//           message: 'User not found'
//         });
//       }

//       // Delete user's bids
//       await db.query('DELETE FROM bids WHERE user_id = ?', [id]);
      
//       // Update auctions created by this user to set created_by to NULL or another user
//       await db.query('UPDATE auctions SET created_by = NULL WHERE created_by = ?', [id]);
      
//       // Delete user from participants
//       await db.query('DELETE FROM auction_participants WHERE user_id = ?', [id]);
      
//       // Finally delete the user
//       const [result] = await db.query('DELETE FROM users WHERE id = ?', [id]);

//       if (result.affectedRows === 0) {
//         await db.query('ROLLBACK');
//         return res.status(400).json({
//           success: false,
//           message: 'Failed to delete user'
//         });
//       }

//       await db.query('COMMIT');

//       res.json({
//         success: true,
//         message: 'User deleted successfully',
//         deleted_user_id: parseInt(id)
//       });

//     } catch (error) {
//       await db.query('ROLLBACK');
//       throw error;
//     }

//   } catch (error) {
//     console.error('❌ Delete user error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

// // Bulk user actions
// exports.bulkUserActions = async (req, res) => {
//   try {
//     const { action, user_ids, status_note } = req.body;

//     if (!action || !user_ids || !Array.isArray(user_ids)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Action and user_ids array are required'
//       });
//     }

//     let updateField;
//     let updateValue;
//     let actionMessage;

//     switch (action) {
//       case 'approve':
//         updateField = 'is_approved';
//         updateValue = true;
//         actionMessage = 'approved';
//         break;
//       case 'reject':
//         updateField = 'is_approved';
//         updateValue = false;
//         actionMessage = 'rejected';
//         break;
//       case 'activate':
//         updateField = 'is_active';
//         updateValue = true;
//         actionMessage = 'activated';
//         break;
//       case 'deactivate':
//         updateField = 'is_active';
//         updateValue = false;
//         actionMessage = 'deactivated';
//         break;
//       case 'delete':
//         // Handle delete separately
//         break;
//       default:
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid action'
//         });
//     }

//     if (action === 'delete') {
//       // Bulk delete handling
//       let processed = 0;
//       const failedIds = [];

//       for (const userId of user_ids) {
//         try {
//           await db.query('DELETE FROM users WHERE id = ?', [userId]);
//           processed++;
//         } catch (error) {
//           failedIds.push(userId);
//         }
//       }

//       res.json({
//         success: true,
//         message: 'Bulk delete completed',
//         processed,
//         failed: failedIds.length,
//         details: {
//           deleted: processed,
//           failed_ids: failedIds
//         }
//       });

//     } else {
//       // Bulk update handling
//       const placeholders = user_ids.map(() => '?').join(',');
//       const [result] = await db.query(
//         `UPDATE users SET ${updateField} = ?, updated_at = NOW(), status_note = ? WHERE id IN (${placeholders})`,
//         [updateValue, status_note || `Bulk ${actionMessage} by admin`, ...user_ids]
//       );

//       res.json({
//         success: true,
//         message: `Users ${actionMessage} successfully`,
//         processed: result.affectedRows,
//         failed: user_ids.length - result.affectedRows,
//         details: {
//           [actionMessage]: result.affectedRows
//         }
//       });
//     }

//   } catch (error) {
//     console.error('❌ Bulk user actions error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };



// Block user
exports.blockUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { status_note } = req.body;

    // Check if user exists
    const [user] = await db.query('SELECT id, status FROM users WHERE id = ?', [id]);
    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Update user status to blocked
      const [result] = await db.query(
        `UPDATE users 
         SET status = 'blocked', 
             is_active = 0, 
             updated_at = NOW(), 
             status_note = ?
         WHERE id = ?`,
        [status_note || 'User blocked by admin', id]
      );

      if (result.affectedRows === 0) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Failed to block user'
        });
      }

      // Cancel all user's active bids
      await db.query(
        `UPDATE bids 
         SET status = 'cancelled', 
             updated_at = NOW() 
         WHERE user_id = ? AND status IN ('pending', 'approved')`,
        [id]
      );

      // Remove user from active auction participants
      await db.query(
        `UPDATE auction_participants 
         SET status = 'removed', 
             updated_at = NOW() 
         WHERE user_id = ? AND status = 'joined'`,
        [id]
      );

      await db.query('COMMIT');

      res.json({
        success: true,
        message: 'User blocked successfully. All active bids cancelled and user removed from ongoing auctions.',
        data: {
          user_id: parseInt(id),
          status: 'blocked',
          is_active: false
        }
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Block user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Unblock user
exports.unblockUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { status_note } = req.body;

    // Check if user exists
    const [user] = await db.query('SELECT id, status FROM users WHERE id = ?', [id]);
    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update user status to active and activate
    const [result] = await db.query(
      `UPDATE users 
       SET status = 'active', 
           is_active = 1, 
           updated_at = NOW(), 
           status_note = ?
       WHERE id = ?`,
      [status_note || 'User unblocked by admin', id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: 'Failed to unblock user'
      });
    }

    res.json({
      success: true,
      message: 'User unblocked successfully',
      data: {
        user_id: parseInt(id),
        status: 'active',
        is_active: true
      }
    });

  } catch (error) {
    console.error('❌ Unblock user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Helper function to check if user is blocked
exports.checkUserBlocked = async (userId) => {
  try {
    const [users] = await db.query(
      'SELECT id, status, is_active FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) return true; // User not found, consider blocked
    
    const user = users[0];
    return user.status === 'blocked' || user.is_active === 0;
  } catch (error) {
    console.error('❌ Check user blocked error:', error);
    return true; // On error, consider blocked for safety
  }
};

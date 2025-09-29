const db = require('../db');

// Get all auctions with filtering
exports.getAuctions = async (req, res) => {
  try {
    // Check if there's an ID parameter (for single auction)
    if (req.params.id) {
      // Get single auction by ID
      const [auction] = await db.query(
        `SELECT a.*, 
          u.person_name AS auctioneer_name, 
          u.company_name AS auctioneer_company, 
          u.phone_number AS auctioneer_phone,
          (SELECT COUNT(*) FROM auction_participants p WHERE p.auction_id = a.id) AS total_participants,
          (SELECT COUNT(*) FROM auction_participants p WHERE p.auction_id = a.id AND p.status='joined') AS joined_participants,
          (SELECT COUNT(*) FROM auction_participants p WHERE p.auction_id = a.id AND p.status='invited') AS invited_participants,
          (SELECT COUNT(*) FROM auction_participants p WHERE p.auction_id = a.id AND p.status='declined') AS declined_participants
        FROM auctions a
        LEFT JOIN users u ON a.created_by = u.id
        WHERE a.id = ?`,
        [req.params.id]
      );
      
      if (auction.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Auction not found'
        });
      }
      
      return res.json({
        success: true,
        auction: auction[0]
      });
    }
    
    // If no ID, get all auctions with filtering
    const { 
      status, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;
    
    let whereConditions = ['1=1'];
    let queryParams = [];
    
    if (status && status !== 'all') {
      whereConditions.push('a.status = ?');
      queryParams.push(status);
    }
    
    if (search) {
      whereConditions.push('(a.title LIKE ? OR a.description LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }
    
    const whereClause = whereConditions.join(' AND ');
    const offset = (page - 1) * limit;
    
    // Get paginated results
    const [auctions] = await db.query(
      `SELECT a.*, 
        u.person_name AS auctioneer_name, 
        u.company_name AS auctioneer_company, 
        u.phone_number AS auctioneer_phone,
        (SELECT COUNT(*) FROM auction_participants p WHERE p.auction_id = a.id) AS total_participants,
        (SELECT COUNT(*) FROM auction_participants p WHERE p.auction_id = a.id AND p.status='joined') AS joined_participants,
        (SELECT COUNT(*) FROM auction_participants p WHERE p.auction_id = a.id AND p.status='invited') AS invited_participants,
        (SELECT COUNT(*) FROM auction_participants p WHERE p.auction_id = a.id AND p.status='declined') AS declined_participants
      FROM auctions a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), offset]
    );
    
    // Count total records for pagination
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM auctions a WHERE ${whereClause}`,
      queryParams
    );
    
    const total = countResult[0].total;
    
    res.json({
      success: true,
      auctions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('❌ Get auctions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get auction by ID with full details
exports.getAuctionById = async (req, res) => {
  try {
    const { id } = req.params;

    /* 1.  Auction header + auctioneer info -------------------- */
    const [auction] = await db.query(
      `SELECT a.*,
              u.person_name AS auctioneer_name,
              u.company_name,
              u.phone_number,
              u.email,
              u.company_address
       FROM auctions a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.id = ?`,
      [id]
    );

    if (!auction.length) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    /* 2.  Participants – phone_number join -------------------- */
    const [participants] = await db.query(
      `SELECT ap.id,
              ap.auction_id,
              ap.user_id,
              ap.phone_number,
              ap.status,
              ap.invited_at,
              ap.joined_at,
              u.person_name,
              u.company_name,
              u.email
       FROM auction_participants ap
       LEFT JOIN users u ON u.phone_number = ap.phone_number
       WHERE ap.auction_id = ?`,
      [id]
    );

    /* 3.  Bids ---------------------------------------------- */
    const [bids] = await db.query(
      `SELECT b.*,
              u.person_name,
              u.company_name
       FROM bids b
       LEFT JOIN users u ON b.user_id = u.id
       WHERE b.auction_id = ?
       ORDER BY b.bid_time DESC`,
      [id]
    );

    /* 4.  Documents ----------------------------------------- */
    const [documents] = await db.query(
      'SELECT * FROM auction_documents WHERE auction_id = ?',
      [id]
    );

    /* 5.  Response ------------------------------------------ */
    res.json({
      success: true,
      auction: {
        ...auction[0],
        participants,
        bids,
        documents
      }
    });

  } catch (error) {
    console.error('❌ Get auction by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update auction status
exports.updateAuctionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Check if auction exists
    const [auction] = await db.query('SELECT id FROM auctions WHERE id = ?', [id]);
    if (auction.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }
    
    // Update status
    await db.query(
      'UPDATE auctions SET status = ?, updated_at = NOW() WHERE id = ?',
      [status, id]
    );
    
    // Get updated auction
    const [updatedAuction] = await db.query(
      `SELECT 
        a.*,
        u.person_name as auctioneer_name,
        u.company_name,
        u.phone_number
      FROM auctions a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.id = ?`,
      [id]
    );
    
    res.json({
      success: true,
      message: 'Auction status updated successfully',
      auction: updatedAuction[0]
    });
    
  } catch (error) {
    console.error('❌ Update auction status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update participant status
exports.updateParticipantStatus = async (req, res) => {
  try {
    const { auctionId, participantId } = req.params;
    const { status } = req.body;
    
    // Check if participant exists
    const [participant] = await db.query(
      'SELECT id FROM auction_participants WHERE id = ? AND auction_id = ?',
      [participantId, auctionId]
    );
    
    if (participant.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Participant not found'
      });
    }
    
    // Update status
    const updateData = { status };
    
    if (status === 'joined') {
      updateData.joined_at = new Date();
    }
    
    await db.query(
      'UPDATE auction_participants SET ? WHERE id = ?',
      [updateData, participantId]
    );
    
    // Get updated participant
    const [updatedParticipant] = await db.query(
      `SELECT 
        ap.*,
        u.person_name,
        u.company_name,
        u.email,
        u.phone_number
      FROM auction_participants ap
      LEFT JOIN users u ON ap.user_id = u.id
      WHERE ap.id = ?`,
      [participantId]
    );
    
    res.json({
      success: true,
      message: 'Participant status updated successfully',
      participant: updatedParticipant[0]
    });
    
  } catch (error) {
    console.error('❌ Update participant status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete auction by ID
exports.deleteAuction = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if auction exists
    const [auction] = await db.query(
      'SELECT id FROM auctions WHERE id = ?',
      [id]
    );

    if (auction.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Delete related data first
    await db.query('DELETE FROM auction_participants WHERE auction_id = ?', [id]);
    await db.query('DELETE FROM bids WHERE auction_id = ?', [id]);
    await db.query('DELETE FROM auction_documents WHERE auction_id = ?', [id]);

    // Delete auction
    await db.query('DELETE FROM auctions WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Auction deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete auction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

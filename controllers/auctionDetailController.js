const db = require('../db'); // your MySQL connection

// Get auction details by ID
exports.getAuctionDetails = async (req, res) => {
    const auctionId = req.params.id;

    try {
        const [rows] = await db.execute(
            `SELECT 
          id,
          title,
          description,
          auction_date,
          start_time,
          DATE_ADD(TIMESTAMP(auction_date, start_time), INTERVAL duration MINUTE) AS end_time,
          pre_bid_allowed,
          currency,
          decremental_value
       FROM auctions
       WHERE id = ?`,
            [auctionId]
        );

        if (rows.length === 0) return res.status(404).json({ message: 'Auction not found' });

        // Format response for frontend
        const auction = rows[0];
        auction.open_to_all = auction.pre_bid_allowed ? 'Yes' : 'No';
        delete auction.pre_bid_allowed;

        res.json(auction);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get simplified bid summary for an auction
exports.getAuctionBids = async (req, res) => {
    const auctionId = req.params.id;

    try {
        // Fetch highest bid per participant (company)
        const [bids] = await db.execute(
            `SELECT u.company_name,
              MAX(b.amount) AS final_bid
       FROM bids b
       JOIN users u ON b.user_id = u.id
       WHERE b.auction_id = ?
       GROUP BY u.company_name
       ORDER BY final_bid DESC`,
            [auctionId]
        );

        // Assign rank manually in JS
        let rank = 1;
        const rankedBids = bids.map((b, index) => {
            if (index > 0 && b.final_bid === bids[index - 1].final_bid) {
                // same rank as previous
                b.rank = rankedBids[index - 1].rank;
            } else {
                b.rank = rank;
            }
            rank++;
            return b;
        });

        res.json({ auctionId, bids: rankedBids });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get auction report by ID
exports.getAuctionReport = async (req, res) => {
    const auctionId = req.params.id;

    if (!auctionId || isNaN(auctionId)) {
        return res.status(400).json({ message: "Invalid auction ID" });
    }

    try {
        console.log(`Fetching auction report for ID: ${auctionId}`);

        // 1. Fetch auction details - using correct columns from your table
        const [auctionResults] = await db.query(
            `SELECT 
                id, 
                title, 
                description, 
                auction_date, 
                start_time, 
                end_time,
                duration,
                currency,
                current_price,
                decremental_value,
                pre_bid_allowed,
                status,
                created_by,
                winner_id,
                created_at,
                updated_at,
                winner_notified
            FROM auctions 
            WHERE id = ?`,
            [auctionId]
        );

        if (!auctionResults || auctionResults.length === 0) {
            return res.status(404).json({ message: "Auction not found" });
        }

        const auction = auctionResults[0];

        // 2. Fetch bids summary with bid ranks
        const [bids] = await db.query(
            `SELECT 
                u.company_name,
                u.id as user_id,
                MIN(b.amount) AS pre_bid_offer,
                MAX(b.amount) AS final_bid_offer,
                COUNT(b.id) AS total_bids,
                RANK() OVER (ORDER BY MAX(b.amount) DESC) AS bid_rank
            FROM bids b
            JOIN users u ON b.user_id = u.id
            WHERE b.auction_id = ?
            GROUP BY u.id, u.company_name
            ORDER BY bid_rank ASC`,
            [auctionId]
        );

        // 3. Return combined response
        res.json({
            ...auction,
            bids: bids,
            summary: {
                total_bidders: bids.length,
                highest_bid: bids.length > 0 ? bids[0].final_bid_offer : auction.current_price || 0
            }
        });

    } catch (err) {
        console.error("Error fetching auction report:", err);
        res.status(500).json({ 
            message: "Internal server error",
            error: err.message
        });
    }
};
// Get all auctions for dropdown
exports.getAllAuctions = async (req, res) => {
  try {
    const userId = req.query.userId; // ?userId=123
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const query = `
      SELECT a.id, a.title, a.status, a.auction_date, a.start_time, 'created' as auction_type
      FROM auctions a WHERE a.created_by = ?
      UNION
      SELECT a.id, a.title, a.status, a.auction_date, a.start_time, 'participated' as auction_type
      FROM auctions a INNER JOIN bids b ON a.id = b.auction_id WHERE b.user_id = ?
      UNION
      SELECT a.id, a.title, a.status, a.auction_date, a.start_time, 'invited' as auction_type
      FROM auctions a INNER JOIN auction_participants ap ON a.id = ap.auction_id WHERE ap.user_id = ?
      ORDER BY auction_date DESC, start_time DESC
    `;

    const [auctions] = await db.query(query, [userId, userId, userId]);

    res.json({ success: true, auctions, count: auctions.length });
  } catch (err) {
    console.error("Error fetching auctions:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/////

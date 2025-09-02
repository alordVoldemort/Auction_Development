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
};// Get auction report by ID
exports.getAuctionReport = async (req, res) => {
    const auctionId = req.params.id;

    try {
        // 1. Fetch auction details
        const [auction] = await db.query(
            "SELECT id, title, decremental_value ,description, auction_date, start_time, base_price, current_price FROM auctions WHERE id = ?",
            [auctionId]
        );

        if (!auction.length) {
            return res.status(404).json({ message: "Auction not found" });
        }

        // 2. Fetch bids summary with bid ranks
        const [bids] = await db.query(
            `SELECT 
                u.company_name,
                MIN(b.amount) AS pre_bid_offer,
                MAX(b.amount) AS final_bid_offer,
                RANK() OVER (ORDER BY MAX(b.amount) DESC) AS bid_rank
            FROM bids b
            JOIN users u ON b.user_id = u.id
            WHERE b.auction_id = ?
            GROUP BY u.company_name
            ORDER BY bid_rank ASC`,
            [auctionId]
        );

        // 3. Return combined response
        res.json({
            ...auction[0],
            bids,
        });
    } catch (err) {
        console.error("Error fetching auction report:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};
// Get all auctions for dropdown
exports.getAllAuctions = async (req, res) => {
    try {
        const [auctions] = await db.query(
            "SELECT id, title FROM auctions ORDER BY auction_date DESC"
        );
        res.json(auctions);
    } catch (err) {
        console.error("Error fetching auctions:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

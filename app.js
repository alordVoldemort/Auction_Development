const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
require('dotenv').config();


const authRoutes = require('./routes/user-auth-routes');
const auctionRoutes = require('./routes/auction');
const myAuctionsRoutes = require('./routes/myAuctions');
const auctionDetailRoutes = require('./routes/auctionDetailRoute');
const dashboardRoutes = require('./routes/dashboard');
const adminauthRoutes = require('./routes/admin-auth-Routes');
const adminRoutes = require('./routes/adminRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminAuctionRoutes = require('./routes/admin-auction-routes');
const adminReportsRoutes = require('./routes/adminReportsRoutes');
const notificationsRoutes  = require('./routes/notificationsRoutes');
// const { initWebSocketServer } = require('./controllers/auctionController');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});
// // After creating HTTP server
// initWebSocketServer(server);

// Store active auctions and connections
const activeAuctions = new Map();

// Start automatic status updates
if (process.env.NODE_ENV !== 'test') {
  require('./cron/auctionStatusUpdater');
  console.log('🔄 Automatic auction status updates enabled');
}

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Make io accessible to routes
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auction', auctionRoutes);
app.use('/api/my-auctions', myAuctionsRoutes);
app.use('/api/auctionreports', auctionDetailRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/admin', adminauthRoutes);
app.use('/api/fulldashboard', adminRoutes);
app.use('/api/user/admin', adminUserRoutes);
app.use('/api/admin/auctions', adminAuctionRoutes);
app.use('/api/admin/reports', adminReportsRoutes);
app.use('/api/notifications',  notificationsRoutes);


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running' });
});

/**
 * ✅ WhatsApp Webhook Verification
 * You must add VERIFY_TOKEN in your .env file
 * Example: VERIFY_TOKEN=my_secret_token_123
 */
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED ✅");
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
  res.sendStatus(400);
});

// ✅ WhatsApp Webhook Listener (incoming messages/events)
app.post("/webhook", (req, res) => {
  const body = req.body;
  console.log("📩 Incoming webhook:", JSON.stringify(body, null, 2));

  if (body.object) {
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      console.log("📥 New WhatsApp Message:", message);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Enhanced WebSocket handling
io.on('connection', (socket) => {
  console.log('🔵 User connected:', socket.id);

  // Join auction room
  socket.on('joinAuction', (data) => {
    const { auctionId, userId } = data;
    socket.join(`auction_${auctionId}`);

    // Track user in active auctions
    if (!activeAuctions.has(auctionId)) {
      activeAuctions.set(auctionId, new Set());
    }
    activeAuctions.get(auctionId).add(userId);

    console.log(`User ${userId} joined auction ${auctionId}`);

    // Send current auction state to the new user
    socket.emit('auctionState', {
      participants: activeAuctions.get(auctionId).size,
      auctionId
    });

    // Notify others about new participant
    socket.to(`auction_${auctionId}`).emit('participantJoined', {
      userId,
      participants: activeAuctions.get(auctionId).size
    });
  });

  // Leave auction room
  socket.on('leaveAuction', (data) => {
    const { auctionId, userId } = data;
    socket.leave(`auction_${auctionId}`);

    if (activeAuctions.has(auctionId)) {
      activeAuctions.get(auctionId).delete(userId);

      // Notify others about participant leaving
      socket.to(`auction_${auctionId}`).emit('participantLeft', {
        userId,
        participants: activeAuctions.get(auctionId).size
      });
    }

    console.log(`User ${userId} left auction ${auctionId}`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('🔴 User disconnected:', socket.id);

    // Clean up from all active auctions
    activeAuctions.forEach((users, auctionId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        io.to(`auction_${auctionId}`).emit('participantLeft', {
          userId: socket.id,
          participants: users.size
        });
      }
    });
  });

  // Handle auction timer sync
  socket.on('requestTimerSync', (auctionId) => {
    // Calculate time remaining and send to client
    const auction = getAuctionById(auctionId); // ⚠️ Implement this in your code
    if (auction) {
      const now = new Date();
      const auctionDateTime = new Date(`${auction.auction_date}T${auction.start_time}`);
      const endTime = new Date(auctionDateTime.getTime() + (auction.duration * 1000));
      const timeRemaining = endTime - now;

      socket.emit('timerSync', {
        auctionId,
        timeRemaining: Math.max(0, timeRemaining),
        status: auction.status
      });
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});

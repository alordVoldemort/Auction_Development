const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/user-auth-routes');
const auctionRoutes = require('./routes/auction');
const myAuctionsRoutes = require('./routes/myAuctions'); 
const auctionDetailRoutes = require('./routes/auctionDetailRoute')
const dashboardRoutes = require('./routes/dashboard');
const adminauthRoutes = require('./routes/admin-auth-Routes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Store active auctions and connections
const activeAuctions = new Map();

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
app.use('/api', adminRoutes);


// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running' });
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
    const auction = getAuctionById(auctionId); // You'll need to implement this
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


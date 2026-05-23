const { Server } = require('socket.io');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CENTRAL_FRONTEND_URL || 'http://localhost:3002',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    const { role, companyId } = socket.handshake.query;
    console.log(`Socket connection request: ${socket.id}, role=${role}, companyId=${companyId}`);

    if (role === 'superadmin') {
      socket.join('superadmin');
      console.log(`Socket ${socket.id} joined superadmin room`);
    } else if (role === 'company_admin' && companyId) {
      socket.join(companyId);
      console.log(`Socket ${socket.id} joined company room: ${companyId}`);
    }

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitAlert(companyId, alert) {
  if (!io) {
    console.error('Socket.IO is not initialized!');
    return;
  }

  console.log(`Broadcasting alert to room ${companyId} and superadmin:`, alert.reason);

  // Emit to company admin room
  io.to(companyId).emit('new_alert', alert);
  // Emit to superadmin room
  io.to('superadmin').emit('new_alert', alert);
}

module.exports = {
  initSocket,
  getIO,
  emitAlert,
};

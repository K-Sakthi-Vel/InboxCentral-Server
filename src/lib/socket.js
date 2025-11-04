const socketIo = require('socket.io');

let io;

function initSocket(server, corsOrigin) {
  io = socketIo(server, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('A user connected via Socket.IO');
    socket.on('disconnect', () => {
      console.log('User disconnected from Socket.IO');
    });
  });

  return io;
}

function getIo() {
  if (!io) {
    throw new Error('Socket.IO not initialized!');
  }
  return io;
}

module.exports = {
  initSocket,
  getIo
};

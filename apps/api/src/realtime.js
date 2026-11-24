// REQ-007, ADR-004: live directory over Socket.IO.
import { Server } from 'socket.io';
import { userFromToken } from './auth.js';

const DIRECTORY_ROLES = ['admin', 'manager'];

export function attachRealtime(httpServer, ctx) {
  const io = new Server(httpServer, { cors: { origin: ctx.corsOrigin || false } });

  io.use((socket, next) => {
    const user = userFromToken(ctx, socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  io.on('connection', (socket) => {
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(socket.data.userId);
    socket.join(`user:${user.id}`);
    if (DIRECTORY_ROLES.includes(user.role)) socket.join('directory');
    socket.emit('ready', { role: user.role });
  });

  return {
    io,
    publish(event, payload) {
      io.to('directory').emit(event, payload);
    },
    // A role change moves the user's open connections in or out of the directory room.
    roleChanged(user) {
      const sockets = io.in(`user:${user.id}`);
      if (DIRECTORY_ROLES.includes(user.role)) sockets.socketsJoin('directory');
      else sockets.socketsLeave('directory');
    },
    // A deactivated user loses their live connection too (REQ-005).
    disconnectUser(id) {
      io.in(`user:${id}`).disconnectSockets(true);
    },
  };
}

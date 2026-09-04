// ==========================================================================
// F.R.I.E.N.D.S QUIZ MULTIPLAYER WEBSOCKET & HTTP SERVER
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// HTTP Static Server
const server = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Fallback to index.html for SPA
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, fallback) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
            res.end(fallback);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

// WebSocket Server
const wss = new WebSocketServer({ server, path: '/ws' });

// Rooms State: { roomCode: { hostWs, players: Map(id => { ws, name, score }), buzzerLocked: false } }
const rooms = new Map();

function broadcastToRoom(roomCode, data, excludeWs = null) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const msg = JSON.stringify(data);
  room.players.forEach((player) => {
    if (player.ws !== excludeWs && player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let currentPlayerId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const { type, roomCode, senderId, senderName, payload } = msg;

      switch (type) {
        case 'CREATE_ROOM': {
          currentRoomCode = roomCode;
          currentPlayerId = senderId;

          const newRoom = {
            hostWs: ws,
            players: new Map(),
            buzzerLocked: false
          };
          newRoom.players.set(senderId, { ws, name: payload.hostName, score: 0, isHost: true });
          rooms.set(roomCode, newRoom);

          console.log(`🏠 Room created: [${roomCode}] by ${payload.hostName}`);
          break;
        }

        case 'JOIN_ROOM': {
          currentRoomCode = roomCode;
          currentPlayerId = senderId;

          let room = rooms.get(roomCode);
          if (!room) {
            // Auto-create if not exists
            room = {
              hostWs: ws,
              players: new Map(),
              buzzerLocked: false
            };
            rooms.set(roomCode, room);
          }

          room.players.set(senderId, { ws, name: payload.playerName, score: 0, isHost: false });
          console.log(`👤 Player joined: ${payload.playerName} in [${roomCode}]`);

          broadcastToRoom(roomCode, msg);
          break;
        }

        case 'SYNC_BUZZER': {
          const room = rooms.get(roomCode);
          if (room) {
            // Check race condition: only first buzzer counts
            if (!room.buzzerLocked) {
              room.buzzerLocked = true;
              console.log(`🔔 BUZZER pressed by ${senderName} in [${roomCode}]`);
              broadcastToRoom(roomCode, msg);
            }
          }
          break;
        }

        case 'NEXT_QUESTION': {
          const room = rooms.get(roomCode);
          if (room) {
            room.buzzerLocked = false;
          }
          broadcastToRoom(roomCode, msg);
          break;
        }

        case 'ANSWER_RESULT': {
          const room = rooms.get(roomCode);
          if (room) {
            if (payload.isCorrect) {
              room.buzzerLocked = true;
            } else {
              // Unlock buzzer for others
              room.buzzerLocked = false;
            }
          }
          broadcastToRoom(roomCode, msg);
          break;
        }

        default:
          broadcastToRoom(roomCode, msg);
          break;
      }
    } catch (err) {
      console.error('Error handling WebSocket message', err);
    }
  });

  ws.on('close', () => {
    if (currentRoomCode && rooms.has(currentRoomCode)) {
      const room = rooms.get(currentRoomCode);
      room.players.delete(currentPlayerId);
      if (room.players.size === 0) {
        rooms.delete(currentRoomCode);
        console.log(`🚪 Room [${currentRoomCode}] closed`);
      }
    }
  });
});

// Helper: Get Local Wi-Fi IP
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Start Server
server.listen(PORT, "0.0.0.0", () => {
  const localIp = getLocalIp();
  console.log('\n======================================================');
  console.log('🎬 F.R.I.E.N.D.S MULTIPLAYER QUIZ PWA SERVER RUNNING!');
  console.log('======================================================');
  console.log(`💻 Local computer access:  http://localhost:${PORT}`);
  console.log(`📱 Phones on same Wi-Fi:   http://${localIp}:${PORT}`);
  console.log('======================================================\n');
});

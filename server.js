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
  // Ignore the query string / hash (Telegram and links add ?params to "/")
  let urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
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

// Authoritative snapshot of scores: { playerId: { name, score, isHost } }
function scoresSnapshot(room) {
  const out = {};
  room.players.forEach((p, id) => {
    out[id] = { name: p.name, score: p.score, isHost: !!p.isHost };
  });
  return out;
}

// Everything a returning (refreshed / reconnected) client needs to restore the screen.
function stateSnapshot(room, roomCode, playerId) {
  const now = Date.now();
  const q = room.q || null;
  let remaining = 60;
  let answerElapsed = 0;
  if (q) {
    if (q.phase === 'QUESTION') remaining = Math.max(1, Math.round(q.base - (now - q.at) / 1000));
    else remaining = Math.max(1, Math.round(q.base));
    if (q.phase === 'BUZZED') answerElapsed = Math.max(0, Math.round((now - q.buzzAt) / 1000));
  }
  const me = room.players.get(playerId);
  return {
    roomCode,
    isHost: !!(me && me.isHost),
    started: !!room.questions,
    over: !!room.finished && !!room.questions,
    questions: room.questions || null,
    q: q ? {
      index: q.index,
      phase: q.phase,
      answeringId: q.answeringId || null,
      failed: q.failed || [],
      remaining,
      answerElapsed
    } : null,
    scores: scoresSnapshot(room)
  };
}

function sendState(ws, room, roomCode, playerId) {
  ws.send(JSON.stringify({ type: 'STATE', roomCode, payload: stateSnapshot(room, roomCode, playerId) }));
}

// Only one game at a time: a room is "active" while it isn't finished and
// at least one of its players still has an open socket.
function hasActiveRoom() {
  for (const room of rooms.values()) {
    if (room.finished) continue;
    for (const p of room.players.values()) {
      if (p.ws && p.ws.readyState === 1) return true;
    }
  }
  return false;
}

// Tell every connected client (even ones not in a room) whether hosting is possible
function broadcastLobbyStatus() {
  const msg = JSON.stringify({ type: 'LOBBY_STATUS', payload: { busy: hasActiveRoom() } });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'LOBBY_STATUS', payload: { busy: hasActiveRoom() } }));
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

          const existing = rooms.get(roomCode);
          if (existing && existing.players.has(senderId)) {
            // Host reconnecting / refreshed the page: keep the room, rebind the socket
            existing.hostWs = ws;
            existing.players.get(senderId).ws = ws;
            sendState(ws, existing, roomCode, senderId);
            break;
          }

          if (payload.rejoin) {
            // The room no longer exists (e.g. server restarted)
            currentRoomCode = null;
            currentPlayerId = null;
            ws.send(JSON.stringify({ type: 'ROOM_GONE', payload: {} }));
            break;
          }

          if (hasActiveRoom()) {
            // Someone else is already hosting
            currentRoomCode = null;
            currentPlayerId = null;
            ws.send(JSON.stringify({ type: 'ROOM_BUSY', payload: {} }));
            break;
          }

          const newRoom = {
            hostWs: ws,
            players: new Map(),
            buzzerLocked: false,
            scoreKeys: new Set()
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
          if (!room && payload.rejoin) {
            currentRoomCode = null;
            currentPlayerId = null;
            ws.send(JSON.stringify({ type: 'ROOM_GONE', payload: {} }));
            break;
          }
          if (!room) {
            // Auto-create if not exists
            room = {
              hostWs: ws,
              players: new Map(),
              buzzerLocked: false,
              scoreKeys: new Set()
            };
            rooms.set(roomCode, room);
          }

          // Re-joining player keeps their score (never reset on reconnect)
          const prev = room.players.get(senderId);
          if (prev) {
            prev.ws = ws;
            prev.name = payload.playerName;
          } else {
            room.players.set(senderId, { ws, name: payload.playerName, score: 0, isHost: false });
          }
          console.log(`👤 Player joined: ${payload.playerName} in [${roomCode}]`);

          broadcastToRoom(roomCode, msg);
          sendState(ws, room, roomCode, senderId);
          break;
        }

        case 'SYNC_BUZZER': {
          const room = rooms.get(roomCode);
          if (room) {
            // Check race condition: only first buzzer counts
            if (!room.buzzerLocked) {
              room.buzzerLocked = true;
              if (room.q && room.q.phase === 'QUESTION') {
                room.q.base = Math.max(0, room.q.base - (Date.now() - room.q.at) / 1000);
                room.q.phase = 'BUZZED';
                room.q.answeringId = senderId;
                room.q.buzzAt = Date.now();
              }
              console.log(`🔔 BUZZER pressed by ${senderName} in [${roomCode}]`);
              broadcastToRoom(roomCode, msg);
            }
          }
          break;
        }

        case 'GAME_STARTED': {
          const room = rooms.get(roomCode);
          if (room) {
            room.finished = false;
            room.buzzerLocked = false;
            room.scoreKeys = new Set();
            room.players.forEach((p) => { p.score = 0; });
            room.questions = payload.questions || null;
            room.q = { index: 0, phase: 'QUESTION', failed: [], answeringId: null, base: 60, at: Date.now() };
          }
          broadcastToRoom(roomCode, msg);
          break;
        }

        case 'END_GAME': {
          // Host aborts the round for everybody and frees the room
          const room = rooms.get(roomCode);
          const me = room && room.players.get(senderId);
          if (room && me && me.isHost) {
            broadcastToRoom(roomCode, { type: 'GAME_ENDED', roomCode, payload: {} });
            rooms.delete(roomCode);
            console.log(`🛑 Game ended by host in [${roomCode}]`);
          }
          currentRoomCode = null;
          currentPlayerId = null;
          break;
        }

        case 'LEAVE_ROOM': {
          const room = rooms.get(roomCode);
          if (room && room.players.has(senderId)) {
            room.players.delete(senderId);
            broadcastToRoom(roomCode, { type: 'PLAYER_LEFT', roomCode, payload: { playerId: senderId } });
            if (room.players.size === 0) rooms.delete(roomCode);
          }
          currentRoomCode = null;
          currentPlayerId = null;
          break;
        }

        case 'GAME_OVER': {
          const room = rooms.get(roomCode);
          if (room) {
            room.finished = true;
            msg.payload = { ...payload, players: scoresSnapshot(room) };
          }
          broadcastToRoom(roomCode, msg);
          break;
        }

        case 'NEXT_QUESTION': {
          const room = rooms.get(roomCode);
          if (room) {
            room.buzzerLocked = false;
            room.q = { index: payload.qIndex, phase: 'QUESTION', failed: [], answeringId: null, base: 60, at: Date.now() };
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

            // Server-side scoring: +1 correct / -2 wrong, once per player per question
            const key = `${payload.qIndex}:${senderId}`;
            const player = room.players.get(senderId);
            if (player && !room.scoreKeys.has(key)) {
              room.scoreKeys.add(key);
              player.score += payload.isCorrect ? 1 : -2;
            }
            if (room.q) {
              if (payload.isCorrect) {
                room.q.phase = 'REVEAL';
              } else {
                if (!room.q.failed.includes(senderId)) room.q.failed.push(senderId);
                const stillIn = [...room.players.keys()].filter((id) => !room.q.failed.includes(id)).length;
                if (stillIn > 0 && room.q.base > 3) {
                  room.q.phase = 'QUESTION';   // question reopens for the others
                  room.q.at = Date.now() + 1500; // client waits 1.5s before reopening
                  room.q.answeringId = null;
                } else {
                  room.q.phase = 'REVEAL';
                }
              }
            }
            msg.payload = { ...payload, scores: scoresSnapshot(room) };
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
    broadcastLobbyStatus();
  });

  ws.on('close', () => {
    broadcastLobbyStatus();
    if (!currentRoomCode || !rooms.has(currentRoomCode)) return;
    const room = rooms.get(currentRoomCode);
    const player = room.players.get(currentPlayerId);
    if (!player || player.ws !== ws) return; // already re-bound to a newer socket

    // Phones drop the socket whenever the browser is backgrounded. Keep the
    // player (and their score) for a grace period so they can reconnect.
    const roomCode = currentRoomCode;
    const playerId = currentPlayerId;
    setTimeout(() => {
      const r = rooms.get(roomCode);
      const p = r && r.players.get(playerId);
      if (!p || p.ws !== ws) return; // reconnected in the meantime
      r.players.delete(playerId);
      if (r.players.size === 0) {
        rooms.delete(roomCode);
        console.log(`🚪 Room [${roomCode}] closed`);
      }
    }, 10 * 60 * 1000);
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

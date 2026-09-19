// ==========================================================================
// Network & Room Sync Manager (WebSockets + Broadcast/Peer Fallback)
// ==========================================================================

class NetworkManager {
  constructor() {
    this.ws = null;
    this.isHost = false;
    this.roomCode = null;
    this.playerName = null;
    this.playerId = 'p_' + Math.random().toString(36).substr(2, 9);
    this.restoredSession = false;
    this._loadSession();
    this.callbacks = {};
    this.connected = false;
    this.broadcastChannel = null;

    if (window.BroadcastChannel) {
      this.broadcastChannel = new BroadcastChannel('friends_quiz_bus');
      this.broadcastChannel.onmessage = (e) => this.handleMessage(e.data);
    }
  }

  on(event, cb) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(cb);
  }

  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(cb => cb(data));
    }
  }

  // ---- session persistence (survives a page refresh / PWA relaunch) ----
  _loadSession() {
    try {
      const raw = localStorage.getItem('friends_quiz_session');
      if (!raw) return;
      const sess = JSON.parse(raw);
      if (!sess || !sess.roomCode || !sess.playerId || Date.now() - sess.savedAt > 3 * 60 * 60 * 1000) {
        localStorage.removeItem('friends_quiz_session');
        return;
      }
      this.playerId = sess.playerId;
      this.playerName = sess.playerName;
      this.roomCode = sess.roomCode;
      this.isHost = !!sess.isHost;
      this.rejoinNeeded = true;       // first WS open re-attaches us to the room
      this.restoredSession = true;
    } catch (e) { /* ignore */ }
  }

  saveSession() {
    try {
      if (!this.roomCode) return;
      localStorage.setItem('friends_quiz_session', JSON.stringify({
        playerId: this.playerId,
        playerName: this.playerName,
        roomCode: this.roomCode,
        isHost: this.isHost,
        savedAt: Date.now()
      }));
    } catch (e) { /* ignore */ }
  }

  clearSession() {
    try { localStorage.removeItem('friends_quiz_session'); } catch (e) { /* ignore */ }
    this.roomCode = null;
    this.isHost = false;
    this.rejoinNeeded = false;
    this.restoredSession = false;
  }

  connect() {
    return new Promise((resolve) => {
      this._resolveFirst = resolve;
      this._open();
    });
  }

  _open() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.everConnected = true;
        this.retry = 0;
        console.log('✅ Connected to WebSocket server');

        // Coming back after a drop: re-attach to the room (server keeps our score)
        if (this.roomCode && this.rejoinNeeded) {
          this.rejoinNeeded = false;
          this._rawSend(this.isHost
            ? { type: 'CREATE_ROOM', payload: { hostId: this.playerId, hostName: this.playerName, rejoin: true } }
            : { type: 'JOIN_ROOM', payload: { playerId: this.playerId, playerName: this.playerName, rejoin: true } });
        }
        // Flush anything queued while offline
        const queued = this.queue || [];
        this.queue = [];
        queued.forEach((m) => ws.send(JSON.stringify(m)));

        if (this._resolveFirst) { this._resolveFirst(true); this._resolveFirst = null; }
      };

      ws.onmessage = (event) => {
        try {
          this.handleMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Invalid message from WS', err);
        }
      };

      ws.onerror = () => {
        console.warn('⚠️ WebSocket error');
        if (this._resolveFirst) { this._resolveFirst(false); this._resolveFirst = null; }
      };

      ws.onclose = () => {
        this.connected = false;
        if (this.roomCode) this.rejoinNeeded = true;
        this._scheduleReconnect();
      };
    } catch (e) {
      this.connected = false;
      if (this._resolveFirst) { this._resolveFirst(false); this._resolveFirst = null; }
      this._scheduleReconnect();
    }
  }

  // Mobile browsers kill sockets when the app is backgrounded — reconnect.
  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this.retry = (this.retry || 0) + 1;
    const delay = Math.min(500 * this.retry, 4000);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._open();
    }, delay);
  }

  _rawSend(partial) {
    const msg = {
      roomCode: this.roomCode,
      senderId: this.playerId,
      senderName: this.playerName,
      timestamp: Date.now(),
      payload: {},
      ...partial
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  send(type, payload = {}) {
    const msg = {
      type,
      roomCode: this.roomCode,
      senderId: this.playerId,
      senderName: this.playerName,
      timestamp: Date.now(),
      payload
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if (this.everConnected) {
      // Temporarily offline: hold the message and deliver it after reconnect
      (this.queue = this.queue || []).push(msg);
    } else if (this.broadcastChannel) {
      // Server never reachable: local-only fallback (tabs on one device)
      this.broadcastChannel.postMessage(msg);
      setTimeout(() => this.handleMessage(msg), 10);
    }
  }

  handleMessage(msg) {
    if (!msg || (msg.roomCode && msg.roomCode !== this.roomCode)) return;
    this.emit(msg.type, msg);
  }

  createRoom(hostName) {
    this.isHost = true;
    this.playerName = hostName || 'Ведущий';
    
    // Generate memorable 4-letter Friends-themed or random room code
    const words = ['ROSS', 'JOEY', 'CHND', 'MONA', 'PHOE', 'RACH', 'EMMA', 'BING', 'BUFF', 'PIVT', 'UNAG', 'HUGS'];
    this.roomCode = words[Math.floor(Math.random() * words.length)] || Math.random().toString(36).substr(2, 4).toUpperCase();

    this.send('CREATE_ROOM', {
      hostId: this.playerId,
      hostName: this.playerName
    });
    this.saveSession();

    return this.roomCode;
  }

  joinRoom(code, playerName) {
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();
    this.playerName = playerName.trim();

    this.send('JOIN_ROOM', {
      playerId: this.playerId,
      playerName: this.playerName
    });
    this.saveSession();
  }
}

window.network = new NetworkManager();

document.addEventListener('visibilitychange', () => {
  const n = window.network;
  if (document.visibilityState === 'visible' && n.everConnected &&
      (!n.ws || n.ws.readyState !== WebSocket.OPEN)) {
    if (n.roomCode) n.rejoinNeeded = true;
    n.retry = 0;
    if (!n._reconnectTimer) n._open();
  }
});

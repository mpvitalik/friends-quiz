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

  connect() {
    return new Promise((resolve) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.connected = true;
          console.log('✅ Connected to WebSocket server');
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (err) {
            console.error('Invalid message from WS', err);
          }
        };

        this.ws.onerror = () => {
          console.warn('⚠️ WebSocket not available, using Local Bus fallback');
          this.connected = false;
          resolve(false);
        };

        this.ws.onclose = () => {
          this.connected = false;
        };
      } catch (e) {
        this.connected = false;
        resolve(false);
      }
    });
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
    } else if (this.broadcastChannel) {
      // Local broadcast fallback (for testing in tabs / local device)
      this.broadcastChannel.postMessage(msg);
      // Also process locally for host/self
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
  }
}

window.network = new NetworkManager();

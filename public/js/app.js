// ==========================================================================
// F.R.I.E.N.D.S QUIZ GAME ENGINE - CLIENT LOGIC
// ==========================================================================

class FriendsQuizGame {
  constructor() {
    this.allQuestions = [];
    this.gameQuestions = [];
    this.currentQIndex = 0;
    this.totalRounds = 20;

    this.players = {}; // { playerId: { name, score, isHost } }
    this.gameState = 'LOBBY'; // LOBBY, QUESTION, BUZZED, REVEAL, GAMEOVER

    // Timers
    this.questionTimeLeft = 60;
    this.answerTimeLeft = 30;
    this.timerInterval = null;
    this.answeringPlayerId = null;
    this.failedPlayersForCurrentQ = new Set();

    // Anti-spam
    this.lastBuzzerAttempt = 0;
    this.isSpamBlocked = false;

    this.init();
  }

  async init() {
    await this.loadQuestions();
    await window.network.connect();
    this.setupNetworkHandlers();
    this.setupDOMHandlers();
  }

  async loadQuestions() {
    try {
      const res = await fetch('data/questions.json');
      this.allQuestions = await res.json();
      console.log(`🎬 Loaded ${this.allQuestions.length} Friends questions!`);
    } catch (e) {
      console.error('Error loading questions', e);
    }
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
  }

  setupDOMHandlers() {
    // Nav buttons
    document.getElementById('btnHostRoom').onclick = () => this.showScreen('screenCreateRoom');
    document.getElementById('btnJoinRoom').onclick = () => this.showScreen('screenJoinRoom');
    document.getElementById('btnBackHome1').onclick = () => this.showScreen('screenHome');
    document.getElementById('btnBackHome2').onclick = () => this.showScreen('screenHome');

    // Create Room
    document.getElementById('btnConfirmCreate').onclick = () => {
      const name = document.getElementById('hostNameInput').value.trim() || 'Чендлер';
      const code = window.network.createRoom(name);
      
      this.players[window.network.playerId] = {
        name,
        score: 0,
        isHost: true
      };

      document.getElementById('displayRoomCode').textContent = code;
      this.renderLobbyPlayers();
      this.showScreen('screenLobby');
    };

    // Join Room
    document.getElementById('btnConfirmJoin').onclick = () => {
      const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
      const name = document.getElementById('playerNameInput').value.trim() || 'Джоуи';

      if (!code || code.length < 3) {
        alert('Введите корректный код комнаты!');
        return;
      }

      window.network.joinRoom(code, name);
      this.players[window.network.playerId] = {
        name,
        score: 0,
        isHost: false
      };

      document.getElementById('displayRoomCode').textContent = code;
      document.getElementById('btnStartGame').style.display = 'none'; // Only host can start
      document.getElementById('lobbyStatusText').textContent = 'Ожидаем, пока ведущий запустит игру...';
      this.renderLobbyPlayers();
      this.showScreen('screenLobby');
    };

    // Start Game (Host only)
    document.getElementById('btnStartGame').onclick = () => {
      if (Object.keys(this.players).length < 1) {
        alert('Нужен хотя бы один игрок!');
        return;
      }
      this.hostStartGame();
    };

    // Buzzer "ЗНАЮ!" Button
    const buzzer = document.getElementById('btnBuzzer');
    buzzer.onclick = () => this.handleBuzzerPress();

    // Option buttons
    document.querySelectorAll('.option-btn').forEach((btn, idx) => {
      btn.onclick = () => this.handleOptionSelect(idx);
    });

    // Share / Download diploma
    document.getElementById('btnDownloadDiploma').onclick = () => this.downloadDiploma();
    document.getElementById('btnPlayAgain').onclick = () => location.reload();
  }

  setupNetworkHandlers() {
    window.network.on('CREATE_ROOM', (msg) => {
      this.players[msg.senderId] = {
        name: msg.payload.hostName,
        score: 0,
        isHost: true
      };
      this.renderLobbyPlayers();
    });

    window.network.on('JOIN_ROOM', (msg) => {
      this.players[msg.senderId] = {
        name: msg.payload.playerName,
        score: 0,
        isHost: false
      };
      this.renderLobbyPlayers();

      // If host, send current state to the new joiner
      if (window.network.isHost) {
        window.network.send('SYNC_PLAYERS', { players: this.players });
      }
    });

    window.network.on('SYNC_PLAYERS', (msg) => {
      this.players = msg.payload.players;
      this.renderLobbyPlayers();
    });

    window.network.on('GAME_STARTED', (msg) => {
      this.gameQuestions = msg.payload.questions;
      this.totalRounds = this.gameQuestions.length;
      this.currentQIndex = 0;
      this.players = msg.payload.players;
      this.showScreen('screenGame');
      this.renderQuestion();
    });

    window.network.on('SYNC_BUZZER', (msg) => {
      this.onPlayerBuzzed(msg.payload.playerId, msg.payload.playerName);
    });

    window.network.on('ANSWER_RESULT', (msg) => {
      this.onAnswerResult(msg.payload);
    });

    window.network.on('NEXT_QUESTION', (msg) => {
      this.currentQIndex = msg.payload.qIndex;
      this.renderQuestion();
    });

    window.network.on('GAME_OVER', (msg) => {
      this.players = msg.payload.players;
      this.renderGameOver();
    });
  }

  renderLobbyPlayers() {
    const list = document.getElementById('lobbyPlayersList');
    list.innerHTML = '';

    Object.entries(this.players).forEach(([id, p]) => {
      const item = document.createElement('div');
      item.className = 'player-item';
      item.innerHTML = `
        <div class="player-name-badge">
          <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
          <span>${p.name}</span>
        </div>
        ${p.isHost ? '<span class="host-badge">👑 Ведущий</span>' : '<span style="color:var(--text-muted);font-size:0.85rem;">Игрок</span>'}
      `;
      list.appendChild(item);
    });

    document.getElementById('playerCountLabel').textContent = `${Object.keys(this.players).length} игроков в лобби`;
  }

  hostStartGame() {
    // Pick 20 random questions from the 502 database
    const shuffled = [...this.allQuestions].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 20);

    window.network.send('GAME_STARTED', {
      questions: selected,
      players: this.players
    });
  }

  renderQuestion() {
    clearInterval(this.timerInterval);
    this.gameState = 'QUESTION';
    this.answeringPlayerId = null;
    this.failedPlayersForCurrentQ.clear();
    this.questionTimeLeft = 60;

    const q = this.gameQuestions[this.currentQIndex];

    // Top status
    document.getElementById('roundBadge').textContent = `Вопрос ${this.currentQIndex + 1} / ${this.totalRounds}`;
    document.getElementById('cardNumBadge').textContent = `#${q.id}`;
    document.getElementById('cardDiffBadge').textContent = q.difficulty || 'Средний';

    // Texts
    document.getElementById('qRuText').textContent = q.question;
    document.getElementById('qEnText').textContent = q.question_en || '';

    // Options (Locked initially!)
    const opts = q.options || [q.answer, 'Вариант B', 'Вариант C', 'Вариант D'];
    document.querySelectorAll('.option-btn').forEach((btn, idx) => {
      btn.className = 'option-btn'; // remove active / correct / wrong
      btn.querySelector('.opt-text').textContent = opts[idx] || '';
    });

    // Reset Explanation
    const exp = document.getElementById('explanationBox');
    exp.className = 'explanation-card';
    exp.innerHTML = `<strong>✅ Ответ:</strong> ${q.answer}<br><span style="margin-top:4px;display:inline-block;">💡 ${q.explanation || ''}</span>`;

    // Reset Buzzer
    const buzzer = document.getElementById('btnBuzzer');
    buzzer.className = 'buzzer-btn';
    document.getElementById('buzzerStatusText').textContent = 'НАЖМИ ПЕРВЫМ!';
    document.getElementById('answeringBanner').classList.remove('show');

    // Start 60s question countdown
    this.updateTimerDisplay(this.questionTimeLeft);
    this.startQuestionTimer();
  }

  startQuestionTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.gameState === 'QUESTION') {
        this.questionTimeLeft--;
        this.updateTimerDisplay(this.questionTimeLeft);

        if (this.questionTimeLeft <= 5) {
          window.sounds.playTick();
        }

        if (this.questionTimeLeft <= 0) {
          clearInterval(this.timerInterval);
          this.handleQuestionTimeout();
        }
      }
    }, 1000);
  }

  updateTimerDisplay(seconds) {
    const el = document.getElementById('timerVal');
    el.textContent = `${seconds}s`;
    if (seconds <= 10) {
      el.parentElement.classList.add('urgent');
    } else {
      el.parentElement.classList.remove('urgent');
    }
  }

  handleBuzzerPress() {
    if (this.gameState !== 'QUESTION') return;
    if (this.failedPlayersForCurrentQ.has(window.network.playerId)) {
      alert('Вы уже отвечали на этот вопрос и ошиблись!');
      return;
    }

    // Anti-spam protection
    const now = Date.now();
    if (now - this.lastBuzzerAttempt < 350) {
      this.isSpamBlocked = true;
      const buzzer = document.getElementById('btnBuzzer');
      buzzer.classList.add('spam-blocked');
      document.getElementById('buzzerStatusText').textContent = '⚠️ ФАЛЬСТАРТ (2с)';
      setTimeout(() => {
        this.isSpamBlocked = false;
        buzzer.classList.remove('spam-blocked');
        document.getElementById('buzzerStatusText').textContent = 'НАЖМИ ПЕРВЫМ!';
      }, 2000);
      return;
    }
    this.lastBuzzerAttempt = now;

    if (this.isSpamBlocked) return;

    window.sounds.playBuzzer();

    // Broadcast buzzer
    window.network.send('SYNC_BUZZER', {
      playerId: window.network.playerId,
      playerName: window.network.playerName
    });
  }

  onPlayerBuzzed(playerId, playerName) {
    if (this.gameState !== 'QUESTION') return;

    this.gameState = 'BUZZED';
    this.answeringPlayerId = playerId;
    this.answerTimeLeft = 30;

    // Lock buzzer for everyone
    const buzzer = document.getElementById('btnBuzzer');
    buzzer.classList.add('locked');

    const banner = document.getElementById('answeringBanner');
    banner.classList.add('show');

    const isMe = (playerId === window.network.playerId);

    if (isMe) {
      banner.textContent = `⚡ ТВОЙ ХОД! Выбирай ответ (30с)`;
      document.getElementById('buzzerStatusText').textContent = 'ВЫБИРАЙ ВАРИАНТ!';
      
      // Unlock option buttons ONLY for this player
      document.querySelectorAll('.option-btn').forEach(b => {
        b.classList.add('active-for-player');
      });
    } else {
      banner.textContent = `Отвечает: ${playerName}... (30с)`;
      document.getElementById('buzzerStatusText').textContent = `ОТВЕЧАЕТ ${playerName.toUpperCase()}`;
    }

    // Start 30s answer timer
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.answerTimeLeft--;
      this.updateTimerDisplay(this.answerTimeLeft);

      if (this.answerTimeLeft <= 0) {
        clearInterval(this.timerInterval);
        if (isMe) {
          // Timeout counts as wrong answer (-2)
          this.submitAnswer(-1, true);
        }
      }
    }, 1000);
  }

  handleOptionSelect(optIndex) {
    if (this.gameState !== 'BUZZED') return;
    if (this.answeringPlayerId !== window.network.playerId) return;

    this.submitAnswer(optIndex, false);
  }

  submitAnswer(optIndex, isTimeout = false) {
    clearInterval(this.timerInterval);
    const q = this.gameQuestions[this.currentQIndex];
    const opts = q.options || [];
    const chosenText = (optIndex >= 0 && opts[optIndex]) ? opts[optIndex] : '';

    const isCorrect = !isTimeout && (
      chosenText.trim().toLowerCase() === q.answer.trim().toLowerCase() ||
      q.answer.toLowerCase().includes(chosenText.toLowerCase())
    );

    window.network.send('ANSWER_RESULT', {
      playerId: window.network.playerId,
      playerName: window.network.playerName,
      optIndex,
      isCorrect,
      isTimeout
    });
  }

  onAnswerResult(payload) {
    clearInterval(this.timerInterval);
    const { playerId, playerName, optIndex, isCorrect } = payload;
    const q = this.gameQuestions[this.currentQIndex];
    const opts = q.options || [];

    // Highlight options
    const optionBtns = document.querySelectorAll('.option-btn');
    optionBtns.forEach(b => b.classList.remove('active-for-player'));

    if (isCorrect) {
      window.sounds.playCorrect();
      this.players[playerId].score += 1;

      if (optIndex >= 0 && optionBtns[optIndex]) {
        optionBtns[optIndex].classList.add('correct');
      }

      document.getElementById('answeringBanner').textContent = `🎉 ${playerName} ответил верно (+1 балл)!`;
      document.getElementById('explanationBox').classList.add('show');

      // Move to next question after 4s
      setTimeout(() => {
        if (window.network.isHost) {
          this.advanceNextQuestion();
        }
      }, 4000);

    } else {
      window.sounds.playWrong();
      this.players[playerId].score -= 2;

      if (optIndex >= 0 && optionBtns[optIndex]) {
        optionBtns[optIndex].classList.add('wrong');
      }

      this.failedPlayersForCurrentQ.add(playerId);

      const remainingPlayersCount = Object.keys(this.players).length - this.failedPlayersForCurrentQ.size;

      if (remainingPlayersCount > 0 && this.questionTimeLeft > 3) {
        document.getElementById('answeringBanner').textContent = `❌ ${playerName} ошибся (-2 балла)! Вопрос снова открыт!`;
        
        // RE-ENABLE BUZZER FOR OTHERS!
        setTimeout(() => {
          this.gameState = 'QUESTION';
          document.getElementById('answeringBanner').classList.remove('show');
          
          if (!this.failedPlayersForCurrentQ.has(window.network.playerId)) {
            document.getElementById('btnBuzzer').classList.remove('locked');
            document.getElementById('buzzerStatusText').textContent = 'НАЖМИ ПЕРВЫМ!';
          } else {
            document.getElementById('buzzerStatusText').textContent = 'ВЫ ЗАБЛОКИРОВАНЫ';
          }

          this.startQuestionTimer();
        }, 1500);

      } else {
        // Everyone failed or time ran out
        document.getElementById('answeringBanner').textContent = `Никто не ответил правильно!`;
        document.getElementById('explanationBox').classList.add('show');
        
        setTimeout(() => {
          if (window.network.isHost) {
            this.advanceNextQuestion();
          }
        }, 4000);
      }
    }
  }

  handleQuestionTimeout() {
    this.gameState = 'REVEAL';
    document.getElementById('answeringBanner').textContent = '⏰ Время вышло!';
    document.getElementById('answeringBanner').classList.add('show');
    document.getElementById('btnBuzzer').classList.add('locked');
    document.getElementById('explanationBox').classList.add('show');

    setTimeout(() => {
      if (window.network.isHost) {
        this.advanceNextQuestion();
      }
    }, 4000);
  }

  advanceNextQuestion() {
    if (this.currentQIndex + 1 < this.totalRounds) {
      window.network.send('NEXT_QUESTION', {
        qIndex: this.currentQIndex + 1
      });
    } else {
      window.network.send('GAME_OVER', {
        players: this.players
      });
    }
  }

  renderGameOver() {
    clearInterval(this.timerInterval);
    this.showScreen('screenGameOver');
    window.sounds.playFanfare();

    // Sort players by score
    const sorted = Object.values(this.players).sort((a, b) => b.score - a.score);
    const winner = sorted[0] || { name: 'Друзья', score: 0 };

    document.getElementById('winnerNameDisplay').textContent = `👑 ${winner.name}`;
    document.getElementById('winnerScoreDisplay').textContent = `${winner.score} баллов`;

    // Render scoreboard
    const board = document.getElementById('finalScoreboard');
    board.innerHTML = '';

    sorted.forEach((p, rank) => {
      const row = document.createElement('div');
      row.className = `score-row ${rank === 0 ? 'winner' : ''}`;
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-weight:900;color:var(--primary-yellow);">${rank + 1}.</span>
          <span>${p.name}</span>
        </div>
        <span style="font-family:var(--font-display);font-size:1.1rem;font-weight:900;color:${p.score >= 0 ? 'var(--success-green)' : 'var(--danger-red)'};">${p.score} б.</span>
      `;
      board.appendChild(row);
    });
  }

  downloadDiploma() {
    const sorted = Object.values(this.players).sort((a, b) => b.score - a.score);
    const winner = sorted[0] || { name: 'Победитель', score: 0 };

    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');

    // Background Gradient
    const bg = ctx.createLinearGradient(0, 0, 1200, 800);
    bg.addColorStop(0, '#1E1B4B');
    bg.addColorStop(0.5, '#0F172A');
    bg.addColorStop(1, '#090D16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 800);

    // Gold Border
    ctx.strokeStyle = '#FFD23F';
    ctx.lineWidth = 12;
    ctx.strokeRect(40, 40, 1120, 720);
    ctx.lineWidth = 3;
    ctx.strokeRect(60, 60, 1080, 680);

    // Friends Dots
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 64px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('F · R · I · E · N · D · S', 600, 160);

    // Certificate Title
    ctx.fillStyle = '#FFD23F';
    ctx.font = '800 36px Montserrat, sans-serif';
    ctx.fillText('ПОЧЕТНАЯ ГРАМОТА ПОБЕДИТЕЛЯ КВИЗА', 600, 240);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 24px Nunito, sans-serif';
    ctx.fillText('Настоящим подтверждается, что звание Главного Эксперта по сериалу «Друзья» получает:', 600, 310);

    // Winner Name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 68px Montserrat, sans-serif';
    ctx.fillText(winner.name.toUpperCase(), 600, 410);

    // Score & Quote
    ctx.fillStyle = '#34D399';
    ctx.font = '800 32px Montserrat, sans-serif';
    ctx.fillText(`Результат: ${winner.score} баллов из 20 раундов`, 600, 490);

    ctx.fillStyle = '#FFD23F';
    ctx.font = 'italic 700 28px Nunito, sans-serif';
    ctx.fillText('«See? She\'s your lobster!» — Фиби Буффе', 600, 580);

    ctx.fillStyle = '#64748B';
    ctx.font = '600 20px Nunito, sans-serif';
    ctx.fillText('Сыграно в официальном PWA Квизе «Друзья»', 600, 680);

    // Download PNG
    const link = document.createElement('a');
    link.download = `Friends_Quiz_Diploma_${winner.name}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new FriendsQuizGame();
});

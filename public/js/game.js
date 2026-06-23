// Connect to Socket.io
const socket = io();

// Web Audio API Synthesizer for high-fidelity game sounds
class SoundSynth {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  playStoneSound() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    // Deep wood drop sound followed by higher tick
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playSkillSound() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.35);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.35);
  }

  playCoquetrySound() {
    this.init();
    if (!this.ctx) return;
    // Magic/sparkle sound: arpeggio
    const playNote = (freq, delay, duration) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + delay + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + delay);
      osc.stop(this.ctx.currentTime + delay + duration);
    };

    playNote(523.25, 0, 0.2); // C5
    playNote(659.25, 0.08, 0.2); // E5
    playNote(783.99, 0.16, 0.2); // G5
    playNote(1046.50, 0.24, 0.3); // C6
  }

  playWinSound() {
    this.init();
    if (!this.ctx) return;
    const playNote = (freq, delay, duration) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.2, this.ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + delay + duration * 0.8);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + delay + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + delay);
      osc.stop(this.ctx.currentTime + delay + duration);
    };

    playNote(523.25, 0, 0.15); // C5
    playNote(523.25, 0.16, 0.15); // C5
    playNote(523.25, 0.32, 0.15); // C5
    playNote(659.25, 0.48, 0.3); // E5
    playNote(587.33, 0.78, 0.3); // D5
    playNote(659.25, 1.08, 0.3); // E5
    playNote(783.99, 1.38, 0.6); // G5
  }
}

const synth = new SoundSynth();

// Game State variables
let myRole = 'spectator'; // p1, p2, spectator
let myName = '';
let currentTurn = 'p1';
let boardState = [];
let doubleDropActive = false;
let silenced = { p1: false, p2: false };
let targetingMode = null; // null or 'SCATTER', 'CONVERT', 'BARRIER', 'FOG', 'SWAP_MY', 'SWAP_OPP', 'CLONE', 'CLONE_DEST', 'CLEAR_AREA'
let swapSelection = { my: null, opp: null }; // { r, c } for swap skill
let cloneSelection = { source: null, dest: null }; // { r, c } for clone skill

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const roomIdInput = document.getElementById('room-id');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');
const rulesBtn = document.getElementById('rules-btn');
const closeRulesBtn = document.getElementById('close-rules-btn');
const rulesOverlay = document.getElementById('rules-overlay');

const displayRoomId = document.getElementById('display-room-id');
const roleBadge = document.getElementById('role-badge');
const turnBanner = document.getElementById('turn-banner');
const readyBtn = document.getElementById('ready-btn');

const p1Name = document.getElementById('p1-name');
const p2Name = document.getElementById('p2-name');
const p1EnergyBar = document.getElementById('p1-energy-bar');
const p2EnergyBar = document.getElementById('p2-energy-bar');
const p1EnergyText = document.getElementById('p1-energy-text');
const p2EnergyText = document.getElementById('p2-energy-text');

const board = document.getElementById('board');
const skillTip = document.getElementById('skill-tip');
const cancelActionBtn = document.getElementById('cancel-action-btn');
const skipBtn = document.getElementById('skip-btn');

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

const heartOverlay = document.getElementById('heart-overlay');
const coquetryUser = document.getElementById('coquetry-user');
const winOverlay = document.getElementById('win-overlay');
const winTitle = document.getElementById('win-title');
const winDesc = document.getElementById('win-desc');
const rematchBtn = document.getElementById('rematch-btn');


// Star Points (hoshi) positions on 15x15 board (0-indexed)
const STAR_POINTS = [
  { r: 3, c: 3 }, { r: 3, c: 11 },
  { r: 7, c: 7 },
  { r: 11, c: 3 }, { r: 11, c: 11 }
];

// Initialize 15x15 board HTML structure
function initBoardDOM() {
  board.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.classList.add(`row-${r}`);
      cell.classList.add(`col-${c}`);
      cell.dataset.row = r;
      cell.dataset.col = c;

      // Mark Star Points
      const isStar = STAR_POINTS.some(p => p.r === r && p.c === c);
      if (isStar) {
        cell.classList.add('star-point-dot');
      }

      // Add click listener
      cell.addEventListener('click', () => handleCellClick(r, c));
      board.appendChild(cell);
    }
  }
}

// Join Room handler
joinBtn.addEventListener('click', () => {
  const roomId = roomIdInput.value.trim();
  const name = playerNameInput.value.trim();

  if (!roomId || !name) {
    alert('请输入房间号和昵称！');
    return;
  }

  myName = name;
  socket.emit('joinRoom', { roomId, name });
  
  // Try to unlock AudioContext on user interaction
  synth.init();
});

// Rules Modal open/close handlers
rulesBtn.addEventListener('click', () => {
  rulesOverlay.classList.remove('hidden');
  synth.init();
});

closeRulesBtn.addEventListener('click', () => {
  rulesOverlay.classList.add('hidden');
});


socket.on('joinedAs', ({ role }) => {
  myRole = role;
  loginScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  displayRoomId.textContent = roomIdInput.value.trim();
  
  // Set role badge styling
  roleBadge.textContent = getRoleName(role);
  roleBadge.className = 'role-badge ' + (role === 'p1' || role === 'p2' ? role : '');
  
  initBoardDOM();
});

// Render the entire game board and update status panels
socket.on('roomState', (room) => {
  currentTurn = room.currentTurn;
  boardState = room.board;
  doubleDropActive = room.doubleDropActive;
  silenced = room.silenced;

  // Update turn header banner
  if (room.gameState === 'waiting') {
    turnBanner.textContent = '等待对局开始...';
    turnBanner.className = 'turn-banner';
    if (myRole === 'p1' || myRole === 'p2') {
      readyBtn.classList.remove('hidden');
    } else {
      readyBtn.classList.add('hidden');
    }
  } else if (room.gameState === 'playing') {
    readyBtn.classList.add('hidden');
    
    // Who's turn?
    const activePlayerName = room.players[room.currentTurn] ? room.players[room.currentTurn].name : '玩家';
    if (room.currentTurn === myRole) {
      turnBanner.textContent = doubleDropActive 
        ? '💕 你正处于【贴贴双弹】状态下，请连续下两子！'
        : '🌟 轮到你了，请落子或施放技能！';
    } else {
      turnBanner.textContent = `⏳ 轮到对方 (${activePlayerName}) 思考落子...`;
    }
    turnBanner.className = 'turn-banner ' + (room.currentTurn === 'p1' ? 'p1-turn' : 'p2-turn');
  } else if (room.gameState === 'ended') {
    turnBanner.textContent = '🏁 对局结束';
    turnBanner.className = 'turn-banner';
    readyBtn.classList.add('hidden');
    
    // Show win overlay
    showWinOverlay(room);
  }

  // Update player panels
  if (room.players.p1) {
    p1Name.textContent = room.players.p1.name;
    p1EnergyBar.style.width = `${room.players.p1.energy}%`;
    p1EnergyText.textContent = `${room.players.p1.energy} / 100 EP`;
  } else {
    p1Name.textContent = '等待加入...';
    p1EnergyBar.style.width = '0%';
    p1EnergyText.textContent = '0 / 100 EP';
  }

  if (room.players.p2) {
    p2Name.textContent = room.players.p2.name;
    p2EnergyBar.style.width = `${room.players.p2.energy}%`;
    p2EnergyText.textContent = `${room.players.p2.energy} / 100 EP`;
  } else {
    p2Name.textContent = '等待加入...';
    p2EnergyBar.style.width = '0%';
    p2EnergyText.textContent = '0 / 100 EP';
  }

  // Active status highlight
  document.getElementById('p1-panel').classList.toggle('active', room.currentTurn === 'p1' && room.gameState === 'playing');
  document.getElementById('p2-panel').classList.toggle('active', room.currentTurn === 'p2' && room.gameState === 'playing');

  // Update Board Grid Cells
  updateBoardCells(room);

  // Update Skill Cards disabled states
  updateSkillBar(room);
});

// Helper to update grid board cells (stones, fog, preview hover classes)
function updateBoardCells(room) {
  const cells = board.querySelectorAll('.cell');
  const myRoleNum = myRole === 'p1' ? 1 : myRole === 'p2' ? 2 : 0;

  cells.forEach(cell => {
    const r = parseInt(cell.dataset.row);
    const c = parseInt(cell.dataset.col);
    const val = room.board[r][c];

    // Clear previous cell contents/classes except star dots
    const stoneEl = cell.querySelector('.stone');
    if (stoneEl) stoneEl.remove();

    const fogEl = cell.querySelector('.fog-overlay');
    if (fogEl) fogEl.remove();

    cell.className = cell.className.replace(/\b(preview-black|preview-white|targetable)\b/g, '').trim();

    // Check Fog of war covering
    let isCoveredByFog = false;
    const opponentRole = myRole === 'p1' ? 'p2' : myRole === 'p2' ? 'p1' : null;
    
    // Spectator doesn't get fog, players only see their own fog mask
    if (opponentRole && room.fog[myRole]) {
      const fogCenter = room.fog[myRole];
      const distance = Math.max(Math.abs(fogCenter.r - r), Math.abs(fogCenter.c - c));
      if (distance <= 2) {
        isCoveredByFog = true;
      }
    }

    if (isCoveredByFog) {
      const fog = document.createElement('div');
      fog.classList.add('fog-overlay');
      cell.appendChild(fog);
    } else {
      // Draw Stone if present
      if (val === 1) {
        const stone = document.createElement('div');
        stone.classList.add('stone', 'black');
        
        // Highlight winning line
        if (room.winningLine && room.winningLine.some(p => p[0] === r && p[1] === c)) {
          stone.classList.add('winning');
        }
        cell.appendChild(stone);
      } else if (val === 2) {
        const stone = document.createElement('div');
        stone.classList.add('stone', 'white');
        
        // Highlight winning line
        if (room.winningLine && room.winningLine.some(p => p[0] === r && p[1] === c)) {
          stone.classList.add('winning');
        }
        cell.appendChild(stone);
      } else if (val === 3) {
        const barrier = document.createElement('div');
        barrier.classList.add('stone', 'barrier');
        cell.appendChild(barrier);
      }

      // Add Preview Classes for hover placement if it is our turn
      if (val === 0 && room.gameState === 'playing' && room.currentTurn === myRole && !targetingMode) {
        if (myRole === 'p1') {
          cell.classList.add('preview-black');
        } else if (myRole === 'p2') {
          cell.classList.add('preview-white');
        }
      }
    }

    // Highlight cell if it's currently targetable by active skill
    if (targetingMode && isCellValidTarget(r, c)) {
      cell.classList.add('targetable');
    }
  });
}

// Update skill cards UI disabled state based on player energy, turn, and silence status
function updateSkillBar(room) {
  const p = room.players[myRole];
  const skillCards = document.querySelectorAll('.skill-card');

  skillCards.forEach(card => {
    const cost = parseInt(card.querySelector('.skill-cost').textContent);
    const skillId = card.dataset.skill;

    // Disabled cases:
    // 1. Not a player (spectator)
    // 2. Game is not playing
    // 3. Not our turn
    // 4. Insufficient energy
    // 5. Silenced
    const isDisabled = 
      !p || 
      room.gameState !== 'playing' || 
      room.currentTurn !== myRole || 
      p.energy < cost || 
      room.silenced[myRole];

    card.classList.toggle('disabled', isDisabled);
  });
}

// Handle Cell Placement or Skill Targeting Click
function handleCellClick(r, c) {
  if (targetingMode) {
    executeSkillTargetClick(r, c);
    return;
  }

  // Normal stone placement
  if (currentTurn === myRole && boardState[r][c] === 0) {
    socket.emit('placeStone', { r, c });
    synth.playStoneSound();
  }
}

// Set up skill cards click listeners
document.querySelectorAll('.skill-card').forEach(card => {
  card.addEventListener('click', () => {
    if (card.classList.contains('disabled')) return;
    const skillId = card.dataset.skill;
    
    // Play button tap
    synth.init();

    // Reset any existing targeting mode
    resetTargetingMode();

    // Skills that execute immediately
    if (skillId === 'COQUETRY' || skillId === 'DOUBLE' || skillId === 'SILENCE' || skillId === 'MEDITATE') {
      socket.emit('useSkill', { skillId });
      synth.playSkillSound();
    } else {
      // Requires target coordinates
      enterTargetingMode(skillId);
    }
  });
});

// Targeting logic helper
function enterTargetingMode(skillId) {
  targetingMode = skillId;
  skillTip.classList.remove('hidden');
  cancelActionBtn.classList.remove('hidden');

  // Highlight skill card
  document.querySelector(`.skill-card[data-skill="${skillId}"]`).classList.add('active-select');

  // Update board cell highlighting
  socket.emit('requestStateRefresh'); // Force redraw cells with targetable highlights
  // Local cell rendering refresh
  const cells = board.querySelectorAll('.cell');
  cells.forEach(cell => {
    const r = parseInt(cell.dataset.row);
    const c = parseInt(cell.dataset.col);
    cell.className = cell.className.replace(/\b(preview-black|preview-white)\b/g, '').trim();
    if (isCellValidTarget(r, c)) {
      cell.classList.add('targetable');
    }
  });

  // Set prompt text
  let promptText = '请在棋盘上选择技能目标...';
  if (skillId === 'SCATTER') promptText = '🌪️ 飞沙走石：选择吹乱的区域中心（3x3）';
  else if (skillId === 'CONVERT') promptText = '💘 偷心贼：选择一个对手的棋子进行转化';
  else if (skillId === 'BARRIER') promptText = '🧱 画地为牢：选择一个空格放置障碍物';
  else if (skillId === 'FOG') promptText = '🌫️ 大雾弥漫：选择一个点放置大雾（5x5）';
  else if (skillId === 'SWAP') promptText = '🔄 斗转星移：请先选择【你自己的】一颗棋子';
  else if (skillId === 'CLONE') promptText = '🔮 无中生有：请先选择【你自己的】一颗棋子';
  else if (skillId === 'CLEAR_AREA') promptText = '💨 风卷残云：选择要清空的区域中心（3x3）';

  skillTip.textContent = promptText;
}

function resetTargetingMode() {
  targetingMode = null;
  swapSelection = { my: null, opp: null };
  cloneSelection = { source: null, dest: null };
  skillTip.classList.add('hidden');
  cancelActionBtn.classList.add('hidden');
  
  document.querySelectorAll('.skill-card').forEach(card => card.classList.remove('active-select'));
  
  // Refresh highlights
  socket.emit('requestStateRefresh'); // Request full refresh to clear target states
}

cancelActionBtn.addEventListener('click', resetTargetingMode);

// Check if a cell is a valid target for the selected skill
function isCellValidTarget(r, c) {
  const val = boardState[r][c];
  const myVal = myRole === 'p1' ? 1 : 2;
  const oppVal = myRole === 'p1' ? 2 : 1;

  switch (targetingMode) {
    case 'BARRIER':
    case 'FOG':
      return val === 0; // Empty intersection
    case 'SCATTER':
    case 'CLEAR_AREA':
      return true; // Any space can be center of scatter or clear
    case 'CONVERT':
      return val === oppVal; // Must be opponent's stone
    case 'SWAP':
      // First select own stone
      return val === myVal;
    case 'SWAP_OPP':
      // Second select opponent's stone
      return val === oppVal;
    case 'CLONE':
      // First select own stone
      return val === myVal;
    case 'CLONE_DEST':
      // Second select empty spot adjacent to source
      if (val !== 0) return false;
      const src = cloneSelection.source;
      return Math.abs(src.r - r) <= 1 && Math.abs(src.c - c) <= 1 && !(src.r === r && src.c === c);
    default:
      return false;
  }
}

// Perform skill invocation with targeted parameters
function executeSkillTargetClick(r, c) {
  if (!isCellValidTarget(r, c)) return;

  const skillId = targetingMode === 'SWAP_OPP' ? 'SWAP' : (targetingMode === 'CLONE_DEST' ? 'CLONE' : targetingMode);
  let params = {};

  if (targetingMode === 'SCATTER') {
    params = { centerR: r, centerC: c };
  } else if (targetingMode === 'CLEAR_AREA') {
    params = { clearR: r, clearC: c };
  } else if (targetingMode === 'CONVERT') {
    params = { convertR: r, convertC: c };
  } else if (targetingMode === 'BARRIER') {
    params = { barrierR: r, barrierC: c };
  } else if (targetingMode === 'FOG') {
    params = { fogR: r, fogC: c };
  } else if (targetingMode === 'SWAP') {
    // Stage 1 of Swap: Select own stone
    swapSelection.my = { r, c };
    targetingMode = 'SWAP_OPP'; // Move to stage 2: Select opponent stone
    skillTip.textContent = '🔄 斗转星移：现在请选择【对方的】一颗棋子';
    
    // Redraw highlights
    const cells = board.querySelectorAll('.cell');
    cells.forEach(cell => {
      cell.classList.remove('targetable');
      const tr = parseInt(cell.dataset.row);
      const tc = parseInt(cell.dataset.col);
      if (isCellValidTarget(tr, tc)) {
        cell.classList.add('targetable');
      }
    });
    return;
  } else if (targetingMode === 'SWAP_OPP') {
    // Stage 2 of Swap: Select opponent stone
    swapSelection.opp = { r, c };
    params = {
      myR: swapSelection.my.r,
      myC: swapSelection.my.c,
      oppR: swapSelection.opp.r,
      oppC: swapSelection.opp.c
    };
  } else if (targetingMode === 'CLONE') {
    // Stage 1 of Clone: Select own stone
    cloneSelection.source = { r, c };
    targetingMode = 'CLONE_DEST'; // Move to stage 2: Select adjacent empty spot
    skillTip.textContent = '🔮 无中生有：现在请选择【相邻的】一个空格位置';
    
    // Redraw highlights
    const cells = board.querySelectorAll('.cell');
    cells.forEach(cell => {
      cell.classList.remove('targetable');
      const tr = parseInt(cell.dataset.row);
      const tc = parseInt(cell.dataset.col);
      if (isCellValidTarget(tr, tc)) {
        cell.classList.add('targetable');
      }
    });
    return;
  } else if (targetingMode === 'CLONE_DEST') {
    // Stage 2 of Clone: Select adjacent destination
    cloneSelection.dest = { r, c };
    params = {
      cloneSourceR: cloneSelection.source.r,
      cloneSourceC: cloneSelection.source.c,
      cloneDestR: cloneSelection.dest.r,
      cloneDestC: cloneSelection.dest.c
    };
  }

  // Send skill command to server
  socket.emit('useSkill', { skillId, params });
  synth.playSkillSound();
  resetTargetingMode();

}

// Ready Button event
readyBtn.addEventListener('click', () => {
  socket.emit('startGame');
  synth.init();
});

// Skip/End Turn manually
skipBtn.addEventListener('click', () => {
  if (currentTurn === myRole) {
    socket.emit('skipTurn');
    synth.init();
  }
});

// Chat handlers
sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('sendMessage', { text });
  chatInput.value = '';
}

socket.on('chatMessage', ({ name, text, time }) => {
  const msgEl = document.createElement('div');
  msgEl.classList.add('chat-msg');

  // Format system messages
  if (name === '系统') {
    msgEl.classList.add('system');
    msgEl.innerHTML = `📢 <strong>${text}</strong>`;
  } else {
    // Color code players
    const isP1 = name === p1Name.textContent;
    const isP2 = name === p2Name.textContent;
    if (isP1) msgEl.classList.add('p1-msg');
    else if (isP2) msgEl.classList.add('p2-msg');

    msgEl.innerHTML = `<span class="chat-time">[${time}]</span> <strong>${name}</strong>: ${text}`;
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Alert Notifications from server
socket.on('notification', ({ type, message }) => {
  alert(message);
});

// Trigger Coquetry Heart Overlay
socket.on('triggerCoquetryEffect', ({ sender }) => {
  coquetryUser.textContent = sender;
  heartOverlay.classList.remove('hidden');
  synth.playCoquetrySound();

  const heartContainer = heartOverlay.querySelector('.heart-container');
  heartContainer.innerHTML = '';

  const heartEmojis = ['❤️', '💖', '💝', '💕', '😘', '💗', '🌸'];

  // Spawn falling/floating hearts
  for (let i = 0; i < 25; i++) {
    const heart = document.createElement('div');
    heart.classList.add('floating-heart');
    heart.textContent = heartEmojis[Math.floor(Math.random() * heartEmojis.length)];
    
    // Random position, delay, and animation duration
    heart.style.left = `${Math.random() * 100}vw`;
    heart.style.animationDelay = `${Math.random() * 0.8}s`;
    heart.style.animationDuration = `${2 + Math.random() * 2}s`;
    heart.style.fontSize = `${1.5 + Math.random() * 2}rem`;

    heartContainer.appendChild(heart);
  }

  // Hide overlay after 3 seconds
  setTimeout(() => {
    heartOverlay.classList.add('hidden');
  }, 2800);
});

// Show Win Dialog Overlay
function showWinOverlay(room) {
  winOverlay.classList.remove('hidden');
  synth.playWinSound();

  const winnerName = room.players[room.winner] ? room.players[room.winner].name : '未知玩家';
  winTitle.textContent = `🏆 ${winnerName} 赢得了本次对局！`;
  
  if (myRole === room.winner) {
    winDesc.textContent = '太棒了！你的智慧与技能搭配无人能挡！快去和对方炫耀一下吧 💖';
  } else if (myRole === 'spectator') {
    winDesc.textContent = `对局已分出胜负，${winnerName} 获得了最终胜利！`;
  } else {
    winDesc.textContent = '哎呀，惜败！不要气馁，下局调配好你的 EP 能量槽报仇雪恨吧！💐';
  }
}

// Rematch Button event
rematchBtn.addEventListener('click', () => {
  winOverlay.classList.add('hidden');
  socket.emit('startGame');
});

// Helper utilities
function getRoleName(role) {
  if (role === 'p1') return '♟️ 执黑 (Player 1)';
  if (role === 'p2') return '🤍 执白 (Player 2)';
  return '👀 旁观者';
}

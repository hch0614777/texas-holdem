// Web Audio API Synthesizer for self-contained sound effects
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function synthSound(freqs, durations, type = 'sine', volume = 0.1) {
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = type;
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    gainNode.gain.setValueAtTime(volume, now);
    
    let timeOffset = 0;
    freqs.forEach((freq, index) => {
      osc.frequency.setValueAtTime(freq, now + timeOffset);
      timeOffset += durations[index];
    });
    
    osc.start(now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + timeOffset);
    osc.stop(now + timeOffset + 0.05);
  } catch (e) {
    console.log("Audio play failed: ", e);
  }
}

function playDealSound() {
  synthSound([600, 450], [0.05, 0.05], 'triangle', 0.15);
}

function playChipsSound() {
  synthSound([1800, 2200], [0.04, 0.04], 'sine', 0.25);
}

function playTurnSound() {
  synthSound([880, 880], [0.08, 0.08], 'sine', 0.1);
}

function playFoldSound() {
  synthSound([350, 180], [0.06, 0.06], 'sawtooth', 0.06);
}

function playWinSound() {
  const freqs = [261.63, 329.63, 392.00, 523.25];
  const durs = [0.12, 0.12, 0.12, 0.35];
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    let now = audioCtx.currentTime;
    freqs.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      gainNode.gain.setValueAtTime(0.15, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + durs[idx]);
      
      osc.start(now);
      osc.stop(now + durs[idx] + 0.02);
      now += 0.12;
    });
  } catch(e) {
    console.log(e);
  }
}

// Socket initialization
const socket = io();

// UI State variables
let currentRoomId = '';
let myName = '';
let mySeatIndex = -1;
let isMyTurn = false;
let myCurrentBet = 0;
let myChips = 0;
let roomState = null;

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const nicknameInput = document.getElementById('nickname-input');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');

const displayRoomId = document.getElementById('display-room-id');
const standBtn = document.getElementById('stand-btn');
const startGameBtn = document.getElementById('start-game-btn');
const potAmount = document.getElementById('pot-amount');
const communityCards = document.getElementById('community-cards');

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendMsgBtn = document.getElementById('send-msg-btn');

// Action panel elements
const actionPanel = document.getElementById('action-panel');
const callValueHint = document.getElementById('call-value-hint');
const raiseValueHint = document.getElementById('raise-value-hint');
const raiseSlider = document.getElementById('raise-slider');
const raiseSliderContainer = document.getElementById('raise-slider-container');
const sliderValueDisplay = document.getElementById('slider-value-display');
const sliderMinus = document.getElementById('slider-minus');
const sliderPlus = document.getElementById('slider-plus');
const quickBetsContainer = document.getElementById('quick-bets-container');
const btnQuickAllIn = document.getElementById('btn-quick-allin');

const foldBtn = document.getElementById('fold-btn');
const checkBtn = document.getElementById('check-btn');
const callBtn = document.getElementById('call-btn');
const raiseBtn = document.getElementById('raise-btn');

// 1. Lobby screen interactions
joinBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  let room = roomInput.value.trim();

  if (!name) {
    showToast('请输入昵称', 'error');
    return;
  }
  if (!room) {
    room = Math.floor(100000 + Math.random() * 900000).toString(); // Generate random room code
  }

  myName = name;
  currentRoomId = room;

  socket.emit('joinRoom', { roomId: currentRoomId, name: myName });
});

// 2. Chat actions
sendMsgBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (text) {
    socket.emit('sendMessage', { text });
    chatInput.value = '';
  }
}

// 3. Sitdown / Seating actions
document.querySelectorAll('.player-seat').forEach(seatElem => {
  const sitBtn = seatElem.querySelector('.sit-btn');
  const seatNum = parseInt(seatElem.getAttribute('data-seat'));

  sitBtn.addEventListener('click', () => {
    socket.emit('sitDown', { seat: seatNum });
  });
});

standBtn.addEventListener('click', () => {
  socket.emit('standUp');
});

startGameBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

// 4. Socket Listeners
socket.on('notification', ({ type, message }) => {
  showToast(message, type);
  if (type === 'success' && currentRoomId) {
    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
    displayRoomId.textContent = currentRoomId;
  }
});

socket.on('chatMessage', ({ name, text, time }) => {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';

  // Format system events nicely
  if (name === '系统') {
    msgDiv.classList.add('system');
    msgDiv.innerHTML = `<span class="msg-text">${text}</span><span class="msg-time">${time}</span>`;
    
    // Play sounds dynamically on system log keywords
    if (text.includes('开始发牌') || text.includes('新局开始')) {
      playDealSound();
    } else if (text.includes('跟注') || text.includes('加注') || text.includes('全押')) {
      playChipsSound();
    } else if (text.includes('弃牌')) {
      playFoldSound();
    } else if (text.includes('赢得了')) {
      playWinSound();
    }
  } else {
    msgDiv.innerHTML = `<span class="msg-sender">${name}:</span><span class="msg-text">${text}</span><span class="msg-time">${time}</span>`;
  }

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Private hole cards dealt to this player
socket.on('playerCards', ({ cards, folded }) => {
  if (mySeatIndex !== -1 && roomState) {
    renderPlayerCards(mySeatIndex, cards, folded);
  }
});

socket.on('roomState', (state) => {
  const oldState = roomState;
  roomState = state;

  // Identify my seating position
  const me = state.players.find(p => p && p.id === socket.id);
  if (me) {
    mySeatIndex = me.seat;
    myChips = me.chips;
    myCurrentBet = me.currentBet;
    standBtn.style.display = 'inline-flex';
  } else {
    mySeatIndex = -1;
    myChips = 0;
    myCurrentBet = 0;
    standBtn.style.display = 'none';
  }

  // 1. Render Seats
  renderSeats(state);

  // 2. Render Community Cards
  renderCommunityCards(state.communityCards);

  // 3. Render Pot
  potAmount.textContent = state.pot;

  // 4. Game controller states
  const activePlayers = state.players.filter(p => p !== null);
  const activePlaying = state.players.filter(p => p && !p.folded && p.chips > 0);
  
  if (state.gameState === 'waiting' && mySeatIndex !== -1 && activePlayers.length >= 2) {
    startGameBtn.style.display = 'inline-flex';
  } else {
    startGameBtn.style.display = 'none';
  }

  // 5. Action Panel setup
  if (state.gameState !== 'waiting' && state.gameState !== 'showdown' && state.currentPlayerIndex === mySeatIndex && mySeatIndex !== -1) {
    // My turn!
    if (!isMyTurn) {
      isMyTurn = true;
      playTurnSound();
    }
    setupActionPanel(state, me);
  } else {
    isMyTurn = false;
    actionPanel.style.display = 'none';
  }
});

// Render Seats UI
function renderSeats(state) {
  const isSpectator = mySeatIndex === -1;

  for (let i = 0; i < 8; i++) {
    const seatElem = document.querySelector(`.player-seat[data-seat="${i}"]`);
    const sitBtn = seatElem.querySelector('.sit-btn');
    const playerCard = seatElem.querySelector('.player-card');

    const player = state.players[i];

    // Reset classes
    seatElem.className = `player-seat seat-${i}`;

    if (player === null) {
      // Empty seat
      playerCard.style.display = 'none';
      if (isSpectator) {
        sitBtn.style.display = 'block';
      } else {
        sitBtn.style.display = 'none'; // Seated players can't sit in another seat
      }
    } else {
      // Seated player
      sitBtn.style.display = 'none';
      playerCard.style.display = 'flex';

      // Update text details
      playerCard.querySelector('.player-name').textContent = player.name;
      playerCard.querySelector('.player-chips').textContent = `🪙 ${player.chips}`;

      // Update bet display
      const betElem = playerCard.querySelector('.player-bet');
      if (player.currentBet > 0) {
        betElem.textContent = `🪙 ${player.currentBet}`;
        betElem.style.display = 'block';
      } else {
        betElem.style.display = 'none';
      }

      // Update Dealer Button
      const dealerBtn = playerCard.querySelector('.dealer-button');
      if (state.dealerIndex === i) {
        dealerBtn.style.display = 'flex';
      } else {
        dealerBtn.style.display = 'none';
      }

      // Handle folded and active states
      if (player.folded) {
        seatElem.classList.add('folded');
      }

      if (state.currentPlayerIndex === i) {
        seatElem.classList.add('active');
      }

      // Status tags (Fold, Check, All-in)
      const statusTag = playerCard.querySelector('.player-status-tag');
      statusTag.style.display = 'none';
      statusTag.className = 'player-status-tag';

      if (player.folded) {
        statusTag.textContent = 'Fold';
        statusTag.classList.add('fold');
        statusTag.style.display = 'block';
      } else if (player.isAllIn) {
        statusTag.textContent = 'All-in';
        statusTag.classList.add('allin');
        statusTag.style.display = 'block';
      }

      // Render cards placeholders or showdown cards
      const cardsContainer = playerCard.querySelector('.player-cards');
      cardsContainer.innerHTML = '';
      
      // If showdown and player didn't fold, show their hands
      if (state.gameState === 'showdown' && !player.folded && player.cards) {
        player.cards.forEach(c => {
          cardsContainer.innerHTML += getCardHTML(c);
        });
      } else if (state.gameState !== 'waiting' && !player.folded && i !== mySeatIndex) {
        // Opponent active hand backcards
        cardsContainer.innerHTML += getCardHTML(null);
        cardsContainer.innerHTML += getCardHTML(null);
      }
    }
  }
}

// Render cards for the self player (hole cards)
function renderPlayerCards(seatIdx, cards, folded) {
  const seatElem = document.querySelector(`.player-seat[data-seat="${seatIdx}"]`);
  if (!seatElem) return;

  const cardsContainer = seatElem.querySelector('.player-cards');
  if (!cardsContainer) return;

  cardsContainer.innerHTML = '';
  if (!folded && cards && cards.length > 0) {
    cards.forEach(c => {
      cardsContainer.innerHTML += getCardHTML(c);
    });
  }
}

// Render community cards on felt
function renderCommunityCards(cards) {
  communityCards.innerHTML = '';
  if (cards && cards.length > 0) {
    cards.forEach(c => {
      communityCards.innerHTML += getCardHTML(c);
    });
  }
}

// Setup Betting actions panel for active player
function setupActionPanel(state, me) {
  actionPanel.style.display = 'flex';

  const toCall = state.currentBetToCall - me.currentBet;
  callValueHint.textContent = toCall > 0 ? toCall : 0;
  raiseValueHint.textContent = state.minRaise;

  // Check vs Call buttons visibility
  if (toCall <= 0) {
    checkBtn.style.display = 'inline-flex';
    callBtn.style.display = 'none';
  } else {
    checkBtn.style.display = 'none';
    callBtn.textContent = `跟注 (Call) ${toCall}`;
    callBtn.style.display = 'inline-flex';
  }

  // Raise slider ranges
  const minRaiseTotal = state.minRaise;
  const maxRaiseTotal = me.chips + me.currentBet; // Total bet size including current bet

  if (me.chips <= toCall) {
    // I don't have enough chips to raise, only fold or call All-in
    raiseBtn.style.display = 'none';
    raiseSliderContainer.style.display = 'none';
    quickBetsContainer.style.display = 'none';
    callBtn.textContent = `全押跟注 (All-in) ${me.chips}`;
  } else {
    raiseBtn.style.display = 'inline-flex';
    raiseSliderContainer.style.display = 'flex';
    quickBetsContainer.style.display = 'flex';

    // Slider setup
    raiseSlider.min = minRaiseTotal;
    raiseSlider.max = maxRaiseTotal;
    raiseSlider.value = minRaiseTotal;
    updateSliderDisplay();
  }
}

// Slider logic
raiseSlider.addEventListener('input', updateSliderDisplay);

sliderMinus.addEventListener('click', () => {
  let val = parseInt(raiseSlider.value);
  const step = roomState ? roomState.largeBlind : 20;
  val = Math.max(parseInt(raiseSlider.min), val - step);
  raiseSlider.value = val;
  updateSliderDisplay();
});

sliderPlus.addEventListener('click', () => {
  let val = parseInt(raiseSlider.value);
  const step = roomState ? roomState.largeBlind : 20;
  val = Math.min(parseInt(raiseSlider.max), val + step);
  raiseSlider.value = val;
  updateSliderDisplay();
});

function updateSliderDisplay() {
  sliderValueDisplay.textContent = raiseSlider.value;
}

// Quick bets clicks
document.querySelectorAll('.btn-quick[data-ratio]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!roomState) return;
    const ratio = btn.getAttribute('data-ratio');
    let val = 0;

    const me = roomState.players[mySeatIndex];
    const toCall = roomState.currentBetToCall - me.currentBet;
    const bb = roomState.largeBlind;

    if (ratio === '1') {
      // Match current Call amount
      val = roomState.currentBetToCall;
    } else if (ratio === '2') {
      val = bb * 2;
    } else if (ratio === '3') {
      val = bb * 3;
    } else if (ratio === 'pot') {
      val = roomState.pot + (roomState.currentBetToCall * 2); // approximate pot raise
    }

    // Clamp value
    val = Math.max(parseInt(raiseSlider.min), val);
    val = Math.min(parseInt(raiseSlider.max), val);

    raiseSlider.value = val;
    updateSliderDisplay();
  });
});

btnQuickAllIn.addEventListener('click', () => {
  raiseSlider.value = raiseSlider.max;
  updateSliderDisplay();
});

// Action buttons sockets emitting
foldBtn.addEventListener('click', () => {
  socket.emit('action', { type: 'fold' });
});

checkBtn.addEventListener('click', () => {
  socket.emit('action', { type: 'check' });
});

callBtn.addEventListener('click', () => {
  socket.emit('action', { type: 'call' });
});

raiseBtn.addEventListener('click', () => {
  const amount = parseInt(raiseSlider.value);
  socket.emit('action', { type: 'raise', amount });
});

// Helper: Card HTML builder
function getCardHTML(card) {
  if (!card) {
    return `<div class="poker-card back"></div>`;
  }
  const suitSymbols = { H: '♥', D: '♦', C: '♣', S: '♠' };
  const suitNames = { H: 'red', D: 'red', C: 'black', S: 'black' };
  const valDisplays = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  
  const valDisplay = valDisplays[card.value] || card.value;
  const suitSymbol = suitSymbols[card.suit];
  const suitClass = suitNames[card.suit];

  return `
    <div class="poker-card ${suitClass}">
      <div class="card-top">${valDisplay}<br>${suitSymbol}</div>
      <div class="card-bottom">${valDisplay}<br>${suitSymbol}</div>
    </div>
  `;
}

// Toast notification helper
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.classList.add('show');
  }, 100);

  // Remove toast
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

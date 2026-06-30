const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { getBestHand, compareScores, evaluate3CardHand } = require('./evaluator');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Global state: rooms
const rooms = {};

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join Room
  socket.on('joinRoom', ({ roomId, name }) => {
    if (!roomId || !name) {
      socket.emit('notification', { type: 'error', message: '房间号和昵称不能为空' });
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerName = name;

    if (!rooms[roomId]) {
      rooms[roomId] = createRoom(roomId);
    }

    const room = rooms[roomId];
    room.spectators.add(socket.id);

    console.log(`User ${name} (${socket.id}) joined room ${roomId}`);
    socket.emit('notification', { type: 'success', message: `成功加入房间 ${roomId}` });

    // Send current room state
    sendRoomState(room);
  });

    // Switch Game Mode (texas or zhajinhua)
    socket.on('switchGameMode', ({ mode }) => {
      const roomId = socket.roomId;
      const room = rooms[roomId];
      if (!room) return;

      if (room.gameState !== 'waiting') {
        socket.emit('notification', { type: 'error', message: '游戏进行中，无法切换游戏模式' });
        return;
      }

      if (mode === 'texas' || mode === 'zhajinhua') {
        room.gameMode = mode;
        const modeName = mode === 'texas' ? '德州扑克' : '炸金花';
        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `游戏模式已切换为: ${modeName}`,
          time: new Date().toLocaleTimeString()
        });
        sendRoomState(room);
      }
    });

    // Look Cards in Zha Jin Hua
    socket.on('lookCards', () => {
      const roomId = socket.roomId;
      const room = rooms[roomId];
      if (!room || room.gameState === 'waiting' || room.gameState === 'showdown') return;

      const playerIndex = room.players.findIndex(p => p && p.id === socket.id);
      if (playerIndex === -1) return;

      const p = room.players[playerIndex];
      if (p.folded || p.seen) return;

      p.seen = true;
      io.to(roomId).emit('chatMessage', {
        name: '系统',
        text: `👀 ${p.name} 看了手牌（已看牌）`,
        time: new Date().toLocaleTimeString()
      });

      // Emit actual cards only to this player
      socket.emit('playerCards', {
        cards: p.cards,
        folded: p.folded,
        handDescription: evaluate3CardHand(p.cards).name
      });

      sendRoomState(room);
    });

  // Sit Down
  socket.on('sitDown', ({ seat }) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    if (seat < 0 || seat >= 8) {
      socket.emit('notification', { type: 'error', message: '无效的位置' });
      return;
    }

    // Check if player is already seated
    const alreadySeated = room.players.find(p => p && p.id === socket.id);
    if (alreadySeated) {
      socket.emit('notification', { type: 'error', message: '你已经坐下了' });
      return;
    }

    // Check if seat is occupied
    if (room.players[seat] !== null) {
      socket.emit('notification', { type: 'error', message: '该座位已被占用' });
      return;
    }

    // Add player to seat
    room.players[seat] = {
      id: socket.id,
      name: socket.playerName || '玩家',
      chips: 1000, // Default starting chips
      seat: seat,
      cards: [],
      currentBet: 0,
      totalBetInHand: 0,
      folded: false,
      isAllIn: false,
      showdownHand: null
    };

    room.spectators.delete(socket.id);
    sendRoomState(room);
    io.to(roomId).emit('chatMessage', {
      name: '系统',
      text: `${socket.playerName} 在 ${seat + 1} 号位坐下了`,
      time: new Date().toLocaleTimeString()
    });
  });

  // Stand Up / Leave Seat
  socket.on('standUp', () => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p && p.id === socket.id);
    if (playerIndex !== -1) {
      const p = room.players[playerIndex];
      // Refund chips if currently playing? For simplicity, we just clear their seat.
      // If game is in progress and they fold/leave, handle fold.
      if (room.gameState !== 'waiting' && !p.folded) {
        handleFold(room, playerIndex);
      }
      room.players[playerIndex] = null;
      room.spectators.add(socket.id);
      sendRoomState(room);
      io.to(roomId).emit('chatMessage', {
        name: '系统',
        text: `${socket.playerName} 离开了座位`,
        time: new Date().toLocaleTimeString()
      });
    }
  });

  // Start Game
  socket.on('startGame', () => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const seatedPlayersCount = room.players.filter(p => p !== null && p.chips > 0).length;
    if (seatedPlayersCount < 2) {
      socket.emit('notification', { type: 'error', message: '至少需要2名有筹码的玩家才能开始游戏' });
      return;
    }

    if (room.gameState !== 'waiting') {
      socket.emit('notification', { type: 'error', message: '游戏已经在进行中' });
      return;
    }

    startNewHand(room);
  });

  // Player Action: fold, check, call, raise, pk
  socket.on('action', ({ type, amount, targetSeat }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || room.gameState === 'waiting' || room.gameState === 'showdown') return;

    const playerIndex = room.players.findIndex(p => p && p.id === socket.id);
    if (playerIndex !== room.currentPlayerIndex) {
      socket.emit('notification', { type: 'error', message: '还没轮到你操作' });
      return;
    }

    const player = room.players[playerIndex];
    let actionExecuted = false;

    if (type === 'fold') {
      handleFold(room, playerIndex);
      actionExecuted = true;
    } else if (type === 'check') {
      if (room.gameMode === 'zhajinhua') {
        socket.emit('notification', { type: 'error', message: '炸金花模式下必须跟注、加注、比牌或弃牌' });
        return;
      }
      // Can check only if currentBet matches currentBetToCall
      if (player.currentBet === room.currentBetToCall) {
        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `${player.name}: 让牌 (Check)`,
          time: new Date().toLocaleTimeString()
        });
        actionExecuted = true;
      } else {
        socket.emit('notification', { type: 'error', message: '不能让牌，你需要跟注或弃牌' });
      }
    } else if (type === 'call') {
      let cost = 0;
      if (room.gameMode === 'zhajinhua') {
        const toCallUnit = room.currentUnitBetToCall - player.currentUnitBet;
        cost = player.seen ? 2 * toCallUnit : toCallUnit;
        if (cost < 0) cost = 0;
      } else {
        cost = room.currentBetToCall - player.currentBet;
      }

      if (cost <= 0 && room.gameMode !== 'zhajinhua') {
        // Essentially a check
        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `${player.name}: 让牌 (Check)`,
          time: new Date().toLocaleTimeString()
        });
        actionExecuted = true;
      } else {
        const chipsToBet = Math.min(cost, player.chips);
        player.chips -= chipsToBet;
        player.currentBet += chipsToBet;
        player.totalBetInHand += chipsToBet;
        
        if (room.gameMode === 'zhajinhua') {
          player.currentUnitBet = room.currentUnitBetToCall;
        }

        const actionText = player.seen ? '明注跟注' : '闷牌跟注';
        const displayLabel = room.gameMode === 'zhajinhua' ? `${actionText} (Call)` : '跟注 (Call)';

        if (player.chips === 0) {
          player.isAllIn = true;
          io.to(roomId).emit('chatMessage', {
            name: '系统',
            text: `${player.name}: 全押跟注 (Call All-in) 筹码: ${player.currentBet}`,
            time: new Date().toLocaleTimeString()
          });
        } else {
          io.to(roomId).emit('chatMessage', {
            name: '系统',
            text: `${player.name}: ${displayLabel} 筹码: ${player.currentBet}`,
            time: new Date().toLocaleTimeString()
          });
        }
        actionExecuted = true;
      }
    } else if (type === 'raise') {
      if (room.gameMode === 'zhajinhua') {
        const targetUnit = parseInt(amount);
        const step = room.largeBlind / 2;
        const minUnitRaise = room.currentUnitBetToCall + step;
        if (isNaN(targetUnit) || targetUnit < minUnitRaise) {
          socket.emit('notification', { type: 'error', message: `最小加注单注必须为 ${minUnitRaise}` });
          return;
        }

        const toRaiseUnit = targetUnit - player.currentUnitBet;
        const cost = player.seen ? 2 * toRaiseUnit : toRaiseUnit;

        if (cost > player.chips) {
          socket.emit('notification', { type: 'error', message: '你的筹码不足以完成此加注' });
          return;
        }

        player.chips -= cost;
        player.currentBet += cost;
        player.totalBetInHand += cost;
        player.currentUnitBet = targetUnit;

        if (player.chips === 0) {
          player.isAllIn = true;
        }

        room.currentUnitBetToCall = targetUnit;
        room.lastRaiserIndex = playerIndex;

        const actionText = player.seen ? '明注加注' : '闷牌加注';
        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `${player.name}: ${actionText} 到单注 ${targetUnit} (消耗筹码 ${cost})`,
          time: new Date().toLocaleTimeString()
        });
        actionExecuted = true;
      } else {
        const raiseTotal = parseInt(amount);
        if (isNaN(raiseTotal) || raiseTotal < room.minRaise) {
          socket.emit('notification', { type: 'error', message: `加注额必须至少为 ${room.minRaise}` });
          return;
        }

        const additionalChips = raiseTotal - player.currentBet;
        if (additionalChips > player.chips) {
          socket.emit('notification', { type: 'error', message: '你的筹码不足以完成此加注' });
          return;
        }

        player.chips -= additionalChips;
        player.currentBet = raiseTotal;
        player.totalBetInHand += additionalChips;

        if (player.chips === 0) {
          player.isAllIn = true;
        }

        const prevBetToCall = room.currentBetToCall;
        room.currentBetToCall = raiseTotal;
        room.minRaise = raiseTotal + (raiseTotal - prevBetToCall);
        room.lastRaiserIndex = playerIndex;

        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `${player.name}: 加注到 (Raise to) ${raiseTotal}`,
          time: new Date().toLocaleTimeString()
        });
        actionExecuted = true;
      }
    } else if (type === 'pk') {
      if (room.gameMode !== 'zhajinhua') return;
      const targetSeatIdx = parseInt(targetSeat);
      const targetPlayer = room.players[targetSeatIdx];
      if (isNaN(targetSeatIdx) || !targetPlayer || targetPlayer.folded || targetSeatIdx === playerIndex) {
        socket.emit('notification', { type: 'error', message: '无效的比牌目标' });
        return;
      }

      // Cost to PK is unit call amount
      const toCallUnit = room.currentUnitBetToCall - player.currentUnitBet;
      const cost = player.seen ? 2 * toCallUnit : toCallUnit;

      if (player.chips < cost) {
        socket.emit('notification', { type: 'error', message: '筹码不足，无法发起比牌' });
        return;
      }

      // Deduct chips
      player.chips -= cost;
      player.currentBet += cost;
      player.totalBetInHand += cost;
      player.currentUnitBet = room.currentUnitBetToCall;
      if (player.chips === 0) {
        player.isAllIn = true;
      }

      // Compare hands
      const myHand = evaluate3CardHand(player.cards);
      const targetHand = evaluate3CardHand(targetPlayer.cards);
      const cmp = compareScores(myHand.score, targetHand.score);

      let winnerPlayer, loserPlayer;
      if (cmp >= 0) {
        winnerPlayer = player;
        loserPlayer = targetPlayer;
      } else {
        winnerPlayer = targetPlayer;
        loserPlayer = player;
      }

      loserPlayer.folded = true;

      io.to(roomId).emit('chatMessage', {
        name: '系统',
        text: `⚔️ 【比牌】${player.name} 向 ${targetPlayer.name} 发起比牌！${loserPlayer.name} 战败弃牌！`,
        time: new Date().toLocaleTimeString()
      });

      actionExecuted = true;
    }

    if (actionExecuted) {
      room.actionCount++;
      nextTurn(room);
    }
  });

  // Chat message
  socket.on('sendMessage', ({ text }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    io.to(roomId).emit('chatMessage', {
      name: socket.playerName || '游客',
      text: text,
      time: new Date().toLocaleTimeString()
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      room.spectators.delete(socket.id);

      const playerIndex = room.players.findIndex(p => p && p.id === socket.id);
      if (playerIndex !== -1) {
        const p = room.players[playerIndex];
        if (room.gameState !== 'waiting' && !p.folded) {
          handleFold(room, playerIndex);
        }
        room.players[playerIndex] = null;
        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `${p.name} 掉线并退出了位置`,
          time: new Date().toLocaleTimeString()
        });
        sendRoomState(room);
      }
      
      // Clean up empty rooms
      const activePlayersCount = room.players.filter(p => p !== null).length;
      if (activePlayersCount === 0 && room.spectators.size === 0) {
        delete rooms[roomId];
        console.log(`Room ${roomId} deleted as it is empty.`);
      }
    }
  });
});

// Create room data structure
function createRoom(roomId) {
  return {
    roomId: roomId,
    gameMode: 'texas', // texas or zhajinhua
    gameState: 'waiting', // waiting, preflop, flop, turn, river, showdown
    players: Array(8).fill(null), // 8 seats
    spectators: new Set(),
    deck: [],
    communityCards: [],
    pot: 0,
    dealerIndex: -1,
    currentPlayerIndex: -1,
    currentBetToCall: 0,
    minRaise: 0,
    smallBlind: 10,
    largeBlind: 20,
    lastRaiserIndex: -1,
    actionCount: 0
  };
}

// Get the next seated player index starting from an index (clockwise)
function getNextSeatedPlayerIndex(room, startFrom, filterFn = null) {
  for (let i = 1; i <= 8; i++) {
    const idx = (startFrom + i) % 8;
    const player = room.players[idx];
    if (player !== null) {
      if (filterFn) {
        if (filterFn(player)) return idx;
      } else {
        return idx;
      }
    }
  }
  return -1;
}

// Start a new hand of poker
function startNewHand(room) {
  room.gameState = 'preflop';
  room.communityCards = [];
  room.pot = 0;
  room.actionCount = 0;

  // Build deck and shuffle
  room.deck = createDeck();
  shuffleDeck(room.deck);

  // Reset player variables
  room.players.forEach(p => {
    if (p) {
      p.cards = [];
      p.currentBet = 0;
      p.totalBetInHand = 0;
      p.folded = false;
      p.isAllIn = false;
      p.showdownHand = null;
      p.seen = false;
      p.currentUnitBet = 0;
    }
  });

  // Determine Dealer, SB, BB positions
  // Dealer moves clockwise
  room.dealerIndex = getNextSeatedPlayerIndex(room, room.dealerIndex, p => p.chips > 0);
  
  const activePlayers = room.players.filter(p => p && p.chips > 0);
  let sbIndex, bbIndex;

  if (activePlayers.length === 2) {
    // Heads-up: Dealer is SB, other player is BB
    sbIndex = room.dealerIndex;
    bbIndex = getNextSeatedPlayerIndex(room, sbIndex, p => p.chips > 0);
  } else {
    sbIndex = getNextSeatedPlayerIndex(room, room.dealerIndex, p => p.chips > 0);
    bbIndex = getNextSeatedPlayerIndex(room, sbIndex, p => p.chips > 0);
  }

  // Deduct small blind
  const sbPlayer = room.players[sbIndex];
  const sbChips = Math.min(room.smallBlind, sbPlayer.chips);
  sbPlayer.chips -= sbChips;
  sbPlayer.currentBet = sbChips;
  sbPlayer.totalBetInHand = sbChips;
  if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;

  // Deduct big blind
  const bbPlayer = room.players[bbIndex];
  const bbChips = Math.min(room.largeBlind, bbPlayer.chips);
  bbPlayer.chips -= bbChips;
  bbPlayer.currentBet = bbChips;
  bbPlayer.totalBetInHand = bbChips;
  if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;

  // Deal hole cards to each seated player (2 for Texas, 3 for Zha Jin Hua)
  const cardsCount = room.gameMode === 'zhajinhua' ? 3 : 2;
  room.players.forEach(p => {
    if (p && p.chips + p.totalBetInHand > 0) {
      for (let c = 0; c < cardsCount; c++) {
        p.cards.push(room.deck.pop());
      }
    } else if (p) {
      p.folded = true; // No chips = auto fold / spectate
    }
  });

  // Set action constraints
  room.currentBetToCall = room.largeBlind;
  room.minRaise = room.largeBlind * 2;

  if (room.gameMode === 'zhajinhua') {
    sbPlayer.currentUnitBet = room.largeBlind / 2;
    bbPlayer.currentUnitBet = room.largeBlind;
    room.currentUnitBetToCall = room.largeBlind;
  }

  // Action starts left of Big Blind (or SB in heads-up)
  if (activePlayers.length === 2) {
    room.currentPlayerIndex = sbIndex;
  } else {
    room.currentPlayerIndex = getNextSeatedPlayerIndex(room, bbIndex, p => !p.folded && !p.isAllIn);
  }
  
  // Last raiser in preflop is the BB player (they get option to check/raise if unraised)
  room.lastRaiserIndex = bbIndex;

  io.to(room.roomId).emit('chatMessage', {
    name: '系统',
    text: `--- 新局开始 (庄家: ${room.players[room.dealerIndex].name}) ---`,
    time: new Date().toLocaleTimeString()
  });

  sendRoomState(room);
}

// Deal next street
function advanceStreet(room) {
  // Collect all bets into main pot
  room.players.forEach(p => {
    if (p) {
      room.pot += p.currentBet;
      p.currentBet = 0;
    }
  });

  room.actionCount = 0;
  room.currentBetToCall = 0;
  room.minRaise = room.largeBlind;

  // Check if we need to showdown early (e.g. if everyone else is folded or all-in)
  const activeNotAllIn = room.players.filter(p => p && !p.folded && !p.isAllIn);
  const activeCount = room.players.filter(p => p && !p.folded).length;

  // If only 1 or 0 players can make further moves, run out the board!
  if (activeNotAllIn.length <= 1 && activeCount > 1) {
    if (room.gameMode === 'zhajinhua') {
      room.gameState = 'showdown';
      handleShowdown(room);
    } else {
      runOutBoard(room);
    }
    return;
  }

  if (room.gameState === 'preflop') {
    if (room.gameMode === 'zhajinhua') {
      room.gameState = 'showdown';
      handleShowdown(room);
      return;
    }
    room.gameState = 'flop';
    room.communityCards.push(room.deck.pop()); // burn a card? we just pop standard
    room.communityCards.push(room.deck.pop());
    room.communityCards.push(room.deck.pop());
    
    // First active player left of Dealer acts first
    room.currentPlayerIndex = getNextSeatedPlayerIndex(room, room.dealerIndex, p => !p.folded && !p.isAllIn);
    room.lastRaiserIndex = room.currentPlayerIndex;
    io.to(room.roomId).emit('chatMessage', {
      name: '系统',
      text: `--- 翻牌圈 (Flop) ---`,
      time: new Date().toLocaleTimeString()
    });
  } else if (room.gameState === 'flop') {
    room.gameState = 'turn';
    room.communityCards.push(room.deck.pop());
    room.currentPlayerIndex = getNextSeatedPlayerIndex(room, room.dealerIndex, p => !p.folded && !p.isAllIn);
    room.lastRaiserIndex = room.currentPlayerIndex;
    io.to(room.roomId).emit('chatMessage', {
      name: '系统',
      text: `--- 转牌圈 (Turn) ---`,
      time: new Date().toLocaleTimeString()
    });
  } else if (room.gameState === 'turn') {
    room.gameState = 'river';
    room.communityCards.push(room.deck.pop());
    room.currentPlayerIndex = getNextSeatedPlayerIndex(room, room.dealerIndex, p => !p.folded && !p.isAllIn);
    room.lastRaiserIndex = room.currentPlayerIndex;
    io.to(room.roomId).emit('chatMessage', {
      name: '系统',
      text: `--- 河牌圈 (River) ---`,
      time: new Date().toLocaleTimeString()
    });
  } else if (room.gameState === 'river') {
    room.gameState = 'showdown';
    handleShowdown(room);
    return;
  }

  sendRoomState(room);
}

// Automatically deals the remaining community cards if players are all-in
function runOutBoard(room) {
  const cardsNeeded = 5 - room.communityCards.length;
  for (let i = 0; i < cardsNeeded; i++) {
    room.communityCards.push(room.deck.pop());
  }
  room.gameState = 'showdown';
  io.to(room.roomId).emit('chatMessage', {
    name: '系统',
    text: `--- 自动发牌完成，直接进入摊牌比牌 ---`,
    time: new Date().toLocaleTimeString()
  });
  handleShowdown(room);
}

// Next turn loop
function nextTurn(room) {
  // Check if only 1 active player is left (others folded)
  const activePlayers = room.players.filter(p => p && !p.folded);
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    room.players.forEach(p => {
      if (p) {
        room.pot += p.currentBet;
        p.currentBet = 0;
      }
    });

    // Format card symbols for chat
    const suitSymbols = { H: '♥', D: '♦', C: '♣', S: '♠' };
    const valDisplays = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
    const cardsText = winner.cards.map(c => `${suitSymbols[c.suit]}${valDisplays[c.value] || c.value}`).join(' ');
    
    let handName = '';
    if (room.gameMode === 'zhajinhua') {
      handName = evaluate3CardHand(winner.cards).name;
    } else {
      handName = getBestHand([...winner.cards, ...room.communityCards]).name;
    }

    winner.chips += room.pot;
    io.to(room.roomId).emit('chatMessage', {
      name: '系统',
      text: `🏆 所有人弃牌，${winner.name} 赢得了底池: ${room.pot} 筹码！手牌为: [${cardsText}] (${handName})`,
      time: new Date().toLocaleTimeString()
    });
    
    room.pot = 0;
    endHand(room);
    return;
  }

  // Find next active player who is NOT folded and NOT all-in
  let nextIdx = getNextSeatedPlayerIndex(room, room.currentPlayerIndex, p => !p.folded && !p.isAllIn);

  // Check if the betting round is complete:
  const activeNotAllIn = room.players.filter(p => p && !p.folded && !p.isAllIn);
  const allMatched = room.gameMode === 'zhajinhua'
    ? activeNotAllIn.every(p => p.currentUnitBet === room.currentUnitBetToCall)
    : activeNotAllIn.every(p => p.currentBet === room.currentBetToCall);

  if (allMatched && (room.actionCount >= activeNotAllIn.length || (activeNotAllIn.length === 0))) {
    // Round complete! Advance to next street
    advanceStreet(room);
  } else {
    // Game continues on this street
    room.currentPlayerIndex = nextIdx;
    sendRoomState(room);
  }
}

// Handle fold action
function handleFold(room, playerIndex) {
  const player = room.players[playerIndex];
  player.folded = true;
  io.to(room.roomId).emit('chatMessage', {
    name: '系统',
    text: `${player.name} 弃牌 (Fold)`,
    time: new Date().toLocaleTimeString()
  });
}

// Showdown: evaluate hands and divide pot
function handleShowdown(room) {
  // Collect final bets to pot
  room.players.forEach(p => {
    if (p) {
      room.pot += p.currentBet;
      p.currentBet = 0;
    }
  });

  const activePlayers = room.players.filter(p => p && !p.folded);
  
  // Calculate best hand for each player
  activePlayers.forEach(p => {
    if (room.gameMode === 'zhajinhua') {
      p.showdownHand = evaluate3CardHand(p.cards);
    } else {
      const fullHand = [...p.cards, ...room.communityCards];
      p.showdownHand = getBestHand(fullHand);
    }
  });

  // Standard showdown pot split logic
  // We sort active players by hand score descending
  const sortedPlayers = [...activePlayers].sort((a, b) => {
    return compareScores(b.showdownHand.score, a.showdownHand.score);
  });

  // Standard Texas Hold'em pot distribution (supporting split pots for equal hands)
  // Simple side-pot solver: 
  // For each player, we know their total contribution (totalBetInHand).
  // We can resolve who gets what portion of the pot.
  // For simplicity, let's divide the pot among the winner(s) with the best hand.
  // If there's an all-in limitation (side pots), we can resolve it.
  // Let's implement standard side-pot division to make the game absolutely professional!

  let potRemaining = room.pot;
  const playerContributions = room.players.map(p => p ? p.totalBetInHand : 0);

  // Group players by hand score
  const handGroups = [];
  sortedPlayers.forEach(p => {
    let group = handGroups.find(g => compareScores(g[0].showdownHand.score, p.showdownHand.score) === 0);
    if (group) {
      group.push(p);
    } else {
      handGroups.push([p]);
    }
  });

  const winnersList = [];

  // Distribute pot layer by layer
  for (const group of handGroups) {
    if (potRemaining <= 0) break;

    // The group contains players who tied with the current best hand rank.
    // Calculate the maximum chips each player in this group can win from each other player.
    // Each winner in the group can win at most their total contribution from every other player's contribution.
    
    // We will do a loop over the group.
    // To do this mathematically: for each winner, we calculate their potential winnings.
    // Let's do a simplified side-pot division:
    // For each winner, we check their total contribution 'C'.
    // They can claim up to 'C' from every player's contribution.
    // We sum these claimable amounts. That is the winner's "claim cap".
    // We divide the available claimable chips among the tied winners.

    // Let's implement a standard round-robin pot divider:
    // Find the smallest totalBetInHand of the winners.
    const sortedWinners = [...group].sort((a, b) => a.totalBetInHand - b.totalBetInHand);
    
    let lastCap = 0;
    for (let i = 0; i < sortedWinners.length; i++) {
      const currentWinner = sortedWinners[i];
      const cap = currentWinner.totalBetInHand;
      if (cap <= lastCap) continue;

      // Calculate how much we can collect from everyone for this tier
      let tierPot = 0;
      for (let j = 0; j < playerContributions.length; j++) {
        if (playerContributions[j] > lastCap) {
          const collect = Math.min(playerContributions[j] - lastCap, cap - lastCap);
          tierPot += collect;
          playerContributions[j] -= collect;
        }
      }

      // Distribute this tier pot evenly among remaining winners in this group (from index i to end)
      const winnersInTier = sortedWinners.slice(i);
      const share = Math.floor(tierPot / winnersInTier.length);
      const remainder = tierPot % winnersInTier.length;

      winnersInTier.forEach((w, idx) => {
        const bonus = (idx === 0) ? remainder : 0; // give remainder to the first one
        const winAmount = share + bonus;
        w.chips += winAmount;
        potRemaining -= winAmount;
        
        winnersList.push({
          name: w.name,
          handName: w.showdownHand.name,
          cards: w.cards,
          winAmount: winAmount
        });
      });

      lastCap = cap;
    }
  }

  // Send winners message
  winnersList.forEach(w => {
    io.to(room.roomId).emit('chatMessage', {
      name: '系统',
      text: `🎉 ${w.name} 赢得了 ${w.winAmount} 筹码! 牌型: ${w.handName}`,
      time: new Date().toLocaleTimeString()
    });
  });

  room.pot = 0;
  sendRoomState(room);

  // Set timeout to clear and prepare next hand
  setTimeout(() => {
    endHand(room);
  }, 3500);
}

// Clean up after a hand and wait/restart
function endHand(room) {
  room.gameState = 'waiting';
  room.communityCards = [];
  
  // Kick players out of seats if they have 0 chips
  room.players.forEach((p, idx) => {
    if (p && p.chips <= 0) {
      io.to(room.roomId).emit('chatMessage', {
        name: '系统',
        text: `${p.name} 筹码已输光，退出了游戏`,
        time: new Date().toLocaleTimeString()
      });
      room.players[idx] = null;
    }
  });

  sendRoomState(room);

  // Auto restart if there are still >= 2 players with chips
  const activePlayersCount = room.players.filter(p => p !== null && p.chips > 0).length;
  if (activePlayersCount >= 2) {
    io.to(room.roomId).emit('chatMessage', {
      name: '系统',
      text: '准备开始下一局，1.5秒后发牌...',
      time: new Date().toLocaleTimeString()
    });
    setTimeout(() => {
      // Check again if room still has players and is waiting
      if (room.gameState === 'waiting') {
        const checkCount = room.players.filter(p => p !== null && p.chips > 0).length;
        if (checkCount >= 2) startNewHand(room);
      }
    }, 1500);
  }
}

// Broadcast game state to all players in the room (hiding secret info)
function sendRoomState(room) {
  io.to(room.roomId).emit('roomState', {
    roomId: room.roomId,
    gameMode: room.gameMode || 'texas',
    gameState: room.gameState,
    communityCards: room.communityCards,
    pot: room.pot,
    dealerIndex: room.dealerIndex,
    currentPlayerIndex: room.currentPlayerIndex,
    currentBetToCall: room.currentBetToCall,
    currentUnitBetToCall: room.currentUnitBetToCall || room.largeBlind,
    minRaise: room.minRaise,
    smallBlind: room.smallBlind,
    largeBlind: room.largeBlind,
    players: room.players.map(p => {
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        chips: p.chips,
        seat: p.seat,
        currentBet: p.currentBet,
        totalBetInHand: p.totalBetInHand,
        folded: p.folded,
        isAllIn: p.isAllIn,
        showdownHand: p.showdownHand,
        seen: p.seen,
        currentUnitBet: p.currentUnitBet
      };
    })
  });

  // Send cards individually to seated players
  room.players.forEach(p => {
    if (p) {
      let handDescription = '';
      let cardsToSend = p.cards;

      if (room.gameMode === 'zhajinhua') {
        if (p.seen || room.gameState === 'showdown') {
          cardsToSend = p.cards;
          if (p.cards.length === 3) {
            handDescription = evaluate3CardHand(p.cards).name;
          }
        } else {
          cardsToSend = p.cards.map(() => null);
          handDescription = '闷牌中';
        }
      } else {
        if (p.cards.length === 2) {
          if (room.communityCards.length === 0) {
            handDescription = '起手底牌';
          } else {
            const fullHand = [...p.cards, ...room.communityCards];
            const bestHand = getBestHand(fullHand);
            handDescription = bestHand.name;
          }
        }
      }

      io.to(p.id).emit('playerCards', {
        cards: cardsToSend,
        folded: p.folded,
        handDescription: handDescription
      });
    }
  });
}

// Card utilities
function createDeck() {
  const suits = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
  const deck = [];
  for (let val = 2; val <= 14; val++) {
    for (const suit of suits) {
      deck.push({ value: val, suit: suit });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

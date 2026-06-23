const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 4000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Global state: rooms
const rooms = {};

// Board dimensions
const BOARD_SIZE = 15;

// Skill definitions
const SKILLS = {
  COQUETRY: { id: 'COQUETRY', name: '撒娇 (悔棋)', cost: 30, desc: '撤销对手的最后一步落子，并发送撒娇特效' },
  SCATTER: { id: 'SCATTER', name: '飞沙走石 (吹乱)', cost: 40, desc: '选择一个3x3区域，使该区域内的所有棋子随机移位' },
  SILENCE: { id: 'SILENCE', name: '静如止水 (封印)', cost: 35, desc: '使对手下回合无法使用任何技能' },
  CONVERT: { id: 'CONVERT', name: '偷心贼 (转化)', cost: 60, desc: '将对方的一枚棋子转化为自己的棋子' },
  SWAP: { id: 'SWAP', name: '斗转星移 (置换)', cost: 45, desc: '选择己方和对方的一枚棋子交换位置' },
  BARRIER: { id: 'BARRIER', name: '画地为牢 (障碍)', cost: 25, desc: '在棋盘上放置一个永久阻挡双方的障碍物' },
  FOG: { id: 'FOG', name: '大雾弥漫 (遮挡)', cost: 30, desc: '遮挡对方部分棋盘视野，持续2个回合' },
  DOUBLE: { id: 'DOUBLE', name: '贴贴 (双弹)', cost: 50, desc: '本回合可以连续落两子，必须相邻' }
};

function createRoom(roomId) {
  const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
  return {
    roomId: roomId,
    gameState: 'waiting', // waiting, playing, ended
    board: board,
    players: {
      p1: null, // Black (starts first)
      p2: null  // White
    },
    spectators: [],
    history: [], // For undo/rewind: array of board states
    currentTurn: 'p1', // 'p1' or 'p2'
    winner: null,
    winningLine: null,
    doubleDropState: {
      active: false,
      firstStone: null // { r, c }
    },
    silenced: {
      p1: false,
      p2: false
    },
    fog: {
      p1: null, // { r, c, expiresTurn }
      p2: null
    },
    turnCount: 1
  };
}

function checkWin(board) {
  const dirs = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal down-right
    [1, -1]   // diagonal down-left
  ];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const player = board[r][c];
      if (player === 0 || player === 3) continue; // 0: empty, 3: obstacle

      for (const [dr, dc] of dirs) {
        let count = 1;
        const line = [[r, c]];

        // Positive direction
        let nr = r + dr;
        let nc = c + dc;
        while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === player) {
          count++;
          line.push([nr, nc]);
          nr += dr;
          nc += dc;
        }

        // Negative direction
        nr = r - dr;
        nc = c - dc;
        while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === player) {
          count++;
          line.push([nr, nc]);
          nr -= dr;
          nc -= dc;
        }

        if (count >= 5) {
          return { winner: player, line };
        }
      }
    }
  }
  return null;
}

function sendRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const serializedPlayers = {};
  for (const role of ['p1', 'p2']) {
    if (room.players[role]) {
      serializedPlayers[role] = {
        id: room.players[role].id,
        name: room.players[role].name,
        energy: room.players[role].energy,
        color: role === 'p1' ? 'black' : 'white'
      };
    } else {
      serializedPlayers[role] = null;
    }
  }

  io.to(roomId).emit('roomState', {
    roomId: room.roomId,
    gameState: room.gameState,
    board: room.board,
    players: serializedPlayers,
    currentTurn: room.currentTurn,
    winner: room.winner,
    winningLine: room.winningLine,
    doubleDropActive: room.doubleDropState.active,
    silenced: room.silenced,
    fog: {
      p1: room.fog.p1 ? { r: room.fog.p1.r, c: room.fog.p1.c } : null,
      p2: room.fog.p2 ? { r: room.fog.p2.r, c: room.fog.p2.c } : null
    },
    turnCount: room.turnCount
  });
}

function saveHistory(room) {
  // Push a deep copy of the board to history
  const boardCopy = room.board.map(row => [...row]);
  room.history.push({
    board: boardCopy,
    currentTurn: room.currentTurn,
    doubleDropState: { ...room.doubleDropState },
    silenced: { ...room.silenced },
    fog: {
      p1: room.fog.p1 ? { ...room.fog.p1 } : null,
      p2: room.fog.p2 ? { ...room.fog.p2 } : null
    },
    p1Energy: room.players.p1 ? room.players.p1.energy : 0,
    p2Energy: room.players.p2 ? room.players.p2.energy : 0,
    turnCount: room.turnCount
  });
  // Cap history size to 30 moves
  if (room.history.length > 30) {
    room.history.shift();
  }
}

// Socket handler
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

    // Auto assign role
    let role = 'spectator';
    if (!room.players.p1) {
      room.players.p1 = { id: socket.id, name, energy: 30 };
      role = 'p1';
    } else if (!room.players.p2 && room.players.p1.id !== socket.id) {
      room.players.p2 = { id: socket.id, name, energy: 35 }; // P2 starts with slightly more energy
      role = 'p2';
    } else {
      room.spectators.push({ id: socket.id, name });
    }

    socket.role = role;
    console.log(`User ${name} joined room ${roomId} as ${role}`);
    
    socket.emit('joinedAs', { role });
    io.to(roomId).emit('chatMessage', {
      name: '系统',
      text: `${name} 加入了房间，角色: ${role === 'p1' ? '执黑(先手)' : role === 'p2' ? '执白(后手)' : '旁观者'}`,
      time: new Date().toLocaleTimeString()
    });

    sendRoomState(roomId);
  });

  // Ready / Start Game
  socket.on('startGame', () => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;

    if (!room.players.p1 || !room.players.p2) {
      socket.emit('notification', { type: 'error', message: '需要两名玩家坐下才能开始游戏' });
      return;
    }

    if (room.gameState === 'playing') {
      socket.emit('notification', { type: 'error', message: '游戏已在进行中' });
      return;
    }

    // Reset board & state
    room.board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
    room.gameState = 'playing';
    room.currentTurn = 'p1';
    room.winner = null;
    room.winningLine = null;
    room.history = [];
    room.turnCount = 1;
    room.players.p1.energy = 30;
    room.players.p2.energy = 35;
    room.silenced = { p1: false, p2: false };
    room.fog = { p1: null, p2: null };
    room.doubleDropState = { active: false, firstStone: null };

    io.to(roomId).emit('chatMessage', {
      name: '系统',
      text: '⚔️ 游戏正式开始！执黑(P1)先手落子。',
      time: new Date().toLocaleTimeString()
    });

    sendRoomState(roomId);
  });

  // Place Stone
  socket.on('placeStone', ({ r, c }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || room.gameState !== 'playing') return;

    const role = socket.role;
    if (role !== room.currentTurn) {
      socket.emit('notification', { type: 'error', message: '还没轮到你落子' });
      return;
    }

    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      socket.emit('notification', { type: 'error', message: '无效的位置' });
      return;
    }

    if (room.board[r][c] !== 0) {
      socket.emit('notification', { type: 'error', message: '该位置已有棋子或障碍物' });
      return;
    }

    // Save history before modifying board
    saveHistory(room);

    const playerNum = role === 'p1' ? 1 : 2;
    room.board[r][c] = playerNum;

    // Handle Double Drop (贴贴) skill logic
    if (room.doubleDropState.active) {
      if (!room.doubleDropState.firstStone) {
        // First stone of the double drop
        room.doubleDropState.firstStone = { r, c };
        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `💕 ${room.players[role].name} 落下了第一子，请在相邻位置落第二子`,
          time: new Date().toLocaleTimeString()
        });
        sendRoomState(roomId);
        return; // Don't switch turn yet
      } else {
        // Second stone of the double drop. Check adjacency.
        const fs = room.doubleDropState.firstStone;
        const diffR = Math.abs(fs.r - r);
        const diffC = Math.abs(fs.c - c);
        if (diffR > 1 || diffC > 1 || (diffR === 0 && diffC === 0)) {
          // Revert first stone placement from board (recover previous board state)
          room.board[fs.r][fs.c] = 0;
          room.doubleDropState.firstStone = null;
          room.history.pop(); // Remove the saved history state
          socket.emit('notification', { type: 'error', message: '贴贴技能落子必须相邻！请重新第一步' });
          sendRoomState(roomId);
          return;
        }
        // Second stone is valid. Deactivate double drop.
        room.doubleDropState.active = false;
        room.doubleDropState.firstStone = null;
      }
    }

    // Check for win
    const winResult = checkWin(room.board);
    if (winResult) {
      room.gameState = 'ended';
      room.winner = winResult.winner === 1 ? 'p1' : 'p2';
      room.winningLine = winResult.line;
      io.to(roomId).emit('chatMessage', {
        name: '系统',
        text: `🏆 恭喜！${room.players[room.winner].name} 赢得了本局游戏！`,
        time: new Date().toLocaleTimeString()
      });
      sendRoomState(roomId);
      return;
    }

    // Switch Turn
    switchTurn(room);
  });

  // Use Skill
  socket.on('useSkill', ({ skillId, params }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || room.gameState !== 'playing') return;

    const role = socket.role;
    if (role !== 'p1' && role !== 'p2') return;

    if (role !== room.currentTurn) {
      socket.emit('notification', { type: 'error', message: '只能在你的回合使用技能' });
      return;
    }

    // Check if silenced
    if (room.silenced[role]) {
      socket.emit('notification', { type: 'error', message: '你本回合处于“静如止水”封印状态，无法使用技能' });
      return;
    }

    const skill = SKILLS[skillId];
    if (!skill) return;

    const p = room.players[role];
    if (p.energy < skill.cost) {
      socket.emit('notification', { type: 'error', message: `能量不足！使用该技能需要 ${skill.cost} 点能量` });
      return;
    }

    // Execute Skill Logic
    let success = false;
    let logMsg = '';

    // Save history before using skill (so they can revert if needed)
    saveHistory(room);

    switch (skillId) {
      case 'COQUETRY': // 撒娇 (Undo)
        if (room.history.length < 2) {
          socket.emit('notification', { type: 'error', message: '当前没有可以撤销的对手棋子' });
          room.history.pop(); // Remove the saved state
          return;
        }
        // Restore board from history (two steps back, to revert opponent's move)
        // Find opponent's last move.
        // We can just pop history until we find a state where the board has one less opponent stone.
        // Simple way: restore to history state index = history.length - 2
        const prevState = room.history[room.history.length - 2];
        room.board = prevState.board.map(row => [...row]);
        room.doubleDropState = { ...prevState.doubleDropState };
        room.silenced = { ...prevState.silenced };
        room.fog = {
          p1: prevState.fog.p1 ? { ...prevState.fog.p1 } : null,
          p2: prevState.fog.p2 ? { ...prevState.fog.p2 } : null
        };
        room.turnCount = prevState.turnCount;
        
        // Subtract cost from energy
        p.energy -= skill.cost;
        success = true;
        logMsg = `💖 ${p.name} 使用了【撒娇】，撤销了对方上一步棋子！`;
        io.to(roomId).emit('triggerCoquetryEffect', { sender: p.name });
        // Don't switch turn, it's still their turn!
        break;

      case 'SCATTER': // 飞沙走石 (Scatter 3x3)
        const { centerR, centerC } = params || {};
        if (centerR === undefined || centerC === undefined) {
          socket.emit('notification', { type: 'error', message: '必须选择吹乱的区域中心' });
          room.history.pop();
          return;
        }

        // Scatter logic: collect all stones in 3x3.
        // For each stone, attempt to push it outwards randomly.
        const stones = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = centerR + dr;
            const nc = centerC + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && room.board[nr][nc] !== 0) {
              stones.push({ r: nr, c: nc, val: room.board[nr][nc] });
              room.board[nr][nc] = 0; // Clear it temporarily
            }
          }
        }

        if (stones.length === 0) {
          socket.emit('notification', { type: 'error', message: '选定区域内没有任何棋子' });
          room.history.pop();
          return;
        }

        // Shuffle stones
        stones.sort(() => Math.random() - 0.5);

        // Put them back in random nearby spaces
        stones.forEach(s => {
          let placed = false;
          // Try outward positions
          const possiblePlacements = [];
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const nr = s.r + dr;
              const nc = s.c + dc;
              if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && room.board[nr][nc] === 0) {
                possiblePlacements.push({ r: nr, c: nc });
              }
            }
          }
          if (possiblePlacements.length > 0) {
            const dest = possiblePlacements[Math.floor(Math.random() * possiblePlacements.length)];
            room.board[dest.r][dest.c] = s.val;
            placed = true;
          } else {
            // Fallback to original position if full
            room.board[s.r][s.c] = s.val;
          }
        });

        p.energy -= skill.cost;
        success = true;
        logMsg = `🌪️ ${p.name} 使用了【飞沙走石】，把以 (${centerR}, ${centerC}) 为中心的棋子吹得乱七八糟！`;
        break;

      case 'SILENCE': // 静如止水 (Silence)
        const opponent = role === 'p1' ? 'p2' : 'p1';
        room.silenced[opponent] = true;
        p.energy -= skill.cost;
        success = true;
        logMsg = `🤫 ${p.name} 使用了【静如止水】，封印了对方的技能！对方下回合不能使用任何技能。`;
        break;

      case 'CONVERT': // 偷心贼 (Convert enemy stone)
        const { convertR, convertC } = params || {};
        if (convertR === undefined || convertC === undefined) {
          socket.emit('notification', { type: 'error', message: '必须选择要转化的棋子' });
          room.history.pop();
          return;
        }
        const enemyVal = role === 'p1' ? 2 : 1;
        if (room.board[convertR][convertC] !== enemyVal) {
          socket.emit('notification', { type: 'error', message: '只能转化对手的棋子' });
          room.history.pop();
          return;
        }

        room.board[convertR][convertC] = role === 'p1' ? 1 : 2;
        p.energy -= skill.cost;
        success = true;
        logMsg = `💘 ${p.name} 使用了【偷心贼】，将 (${convertR}, ${convertC}) 的棋子据为己有！`;
        break;

      case 'SWAP': // 斗转星移 (Swap stones)
        const { myR, myC, oppR, oppC } = params || {};
        if (myR === undefined || myC === undefined || oppR === undefined || oppC === undefined) {
          socket.emit('notification', { type: 'error', message: '必须选择己方和对方的一枚棋子来进行位置互换' });
          room.history.pop();
          return;
        }
        const myVal = role === 'p1' ? 1 : 2;
        const targetOppVal = role === 'p1' ? 2 : 1;

        if (room.board[myR][myC] !== myVal || room.board[oppR][oppC] !== targetOppVal) {
          socket.emit('notification', { type: 'error', message: '选定的棋子类型不正确' });
          room.history.pop();
          return;
        }

        // Swap values
        room.board[myR][myC] = targetOppVal;
        room.board[oppR][oppC] = myVal;

        p.energy -= skill.cost;
        success = true;
        logMsg = `🔄 ${p.name} 使用了【斗转星移】，互换了自己位于 (${myR}, ${myC}) 和对方位于 (${oppR}, ${oppC}) 的棋子！`;
        break;

      case 'BARRIER': // 画地为牢 (Barrier)
        const { barrierR, barrierC } = params || {};
        if (barrierR === undefined || barrierC === undefined) {
          socket.emit('notification', { type: 'error', message: '必须选择放置障碍物的位置' });
          room.history.pop();
          return;
        }
        if (room.board[barrierR][barrierC] !== 0) {
          socket.emit('notification', { type: 'error', message: '这里已经有棋子，无法放置障碍物' });
          room.history.pop();
          return;
        }

        room.board[barrierR][barrierC] = 3; // 3 represents obstacle
        p.energy -= skill.cost;
        success = true;
        logMsg = `🧱 ${p.name} 使用了【画地为牢】，在 (${barrierR}, ${barrierC}) 放置了一个永久障碍物！`;
        break;

      case 'FOG': // 大雾弥漫 (Fog of war)
        const { fogR, fogC } = params || {};
        if (fogR === undefined || fogC === undefined) {
          socket.emit('notification', { type: 'error', message: '必须选择迷雾的中心位置' });
          room.history.pop();
          return;
        }
        const targetRole = role === 'p1' ? 'p2' : 'p1';
        room.fog[targetRole] = {
          r: fogR,
          c: fogC,
          expiresTurn: room.turnCount + 4 // expires after 2 of opponent's turns (4 turns total in switch count)
        };
        p.energy -= skill.cost;
        success = true;
        logMsg = `🌫️ ${p.name} 使用了【大雾弥漫】，在以 (${fogR}, ${fogC}) 为中心的 5x5 区域升起了迷雾，阻挡对方视野！`;
        break;

      case 'DOUBLE': // 贴贴 (Double drop)
        room.doubleDropState.active = true;
        room.doubleDropState.firstStone = null;
        p.energy -= skill.cost;
        success = true;
        logMsg = `💕 ${p.name} 使用了【贴贴】，这回合可以连续落两枚相邻的棋子！`;
        // Do not switch turn - we want them to place 2 stones now.
        break;

      default:
        room.history.pop();
        return;
    }

    if (success) {
      // Check win after skill executes
      const winResult = checkWin(room.board);
      if (winResult) {
        room.gameState = 'ended';
        room.winner = winResult.winner === 1 ? 'p1' : 'p2';
        room.winningLine = winResult.line;
        logMsg += ` 🏆 这让他们直接赢得了比赛！`;
      }

      io.to(roomId).emit('chatMessage', {
        name: '系统',
        text: logMsg,
        time: new Date().toLocaleTimeString()
      });

      // Silencing is spent once they use a skill or end their turn, but here we keep track
      // If the skill doesn't switch turns (like COQUETRY or DOUBLE), we don't switch.
      // Otherwise, we switch turn.
      if (skillId !== 'COQUETRY' && skillId !== 'DOUBLE' && room.gameState === 'playing') {
        switchTurn(room);
      } else {
        sendRoomState(roomId);
      }
    }
  });

  // End Turn manually (useful if stuck or for double drop cancellation)
  socket.on('skipTurn', () => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || room.gameState !== 'playing') return;

    const role = socket.role;
    if (role !== room.currentTurn) return;

    io.to(roomId).emit('chatMessage', {
      name: '系统',
      text: `${room.players[role].name} 放弃操作，跳过回合。`,
      time: new Date().toLocaleTimeString()
    });

    if (room.doubleDropState.active) {
      // Cancel double drop if skipped
      room.doubleDropState.active = false;
      room.doubleDropState.firstStone = null;
    }

    switchTurn(room);
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

      // Remove player
      if (room.players.p1 && room.players.p1.id === socket.id) {
        room.players.p1 = null;
        room.gameState = 'waiting';
        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `玩家1(黑棋) 离开了房间，游戏重置。`,
          time: new Date().toLocaleTimeString()
        });
      } else if (room.players.p2 && room.players.p2.id === socket.id) {
        room.players.p2 = null;
        room.gameState = 'waiting';
        io.to(roomId).emit('chatMessage', {
          name: '系统',
          text: `玩家2(白棋) 离开了房间，游戏重置。`,
          time: new Date().toLocaleTimeString()
        });
      } else {
        room.spectators = room.spectators.filter(s => s.id !== socket.id);
      }

      // Delete empty room
      if (!room.players.p1 && !room.players.p2 && room.spectators.length === 0) {
        delete rooms[roomId];
        console.log(`Room ${roomId} deleted as it is empty.`);
      } else {
        sendRoomState(roomId);
      }
    }
  });
});

function switchTurn(room) {
  // Check fog expiration
  const nextRole = room.currentTurn === 'p1' ? 'p2' : 'p1';
  
  // Update turn
  room.currentTurn = nextRole;
  room.turnCount++;

  // Clear silence for the player whose turn just ended
  const prevRole = nextRole === 'p1' ? 'p2' : 'p1';
  room.silenced[prevRole] = false;

  // Clear fog if expired
  if (room.fog[room.currentTurn] && room.turnCount >= room.fog[room.currentTurn].expiresTurn) {
    room.fog[room.currentTurn] = null;
    io.to(room.roomId).emit('chatMessage', {
      name: '系统',
      text: `🌫️ 笼罩在 ${room.players[room.currentTurn].name} 视线上的迷雾消散了。`,
      time: new Date().toLocaleTimeString()
    });
  }

  // Grant energy on turn start (e.g. +10 energy per turn, capped at 100)
  const activePlayer = room.players[room.currentTurn];
  if (activePlayer) {
    activePlayer.energy = Math.min(100, activePlayer.energy + 10);
  }

  sendRoomState(room.roomId);
}

// Start Server
server.listen(PORT, () => {
  console.log(`Skill Gobang Server running on port ${PORT}`);
});

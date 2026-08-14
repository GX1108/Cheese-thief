"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const MIN_PLAYERS = 5;
const MAX_PLAYERS = 8;
const CONFIRM_PHASE_MS = 15000;
const NIGHT_ROUND_MS = 15000;
const SOLO_PEEK_TIMEOUT_MS = 15000;
const PHASE_TRANSITION_MS = 2500;

const ROLE = {
  THIEF: "奶酪大盜",
  MOUSE: "貪睡鼠"
};

/** @type {Map<number, Room>} */
const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = crypto.randomInt(1, 1000); // 1 - 999
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function send(ws, type, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function broadcast(room, type, payload, excludePlayerId) {
  for (const player of room.players.values()) {
    if (player.id === excludePlayerId) continue;
    send(player.ws, type, payload);
  }
}

function publicRoomSummary(room) {
  return {
    code: room.code,
    isPublic: room.isPublic,
    maxPlayers: MAX_PLAYERS,
    currentPlayers: room.players.size,
    status: room.status
  };
}

function lobbySummary(room) {
  return {
    code: room.code,
    isPublic: room.isPublic,
    status: room.status,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, connected: p.connected }))
  };
}

function createRoom({ isPublic, password }) {
  const code = generateRoomCode();
  const room = {
    code,
    isPublic,
    password: isPublic ? null : password,
    players: new Map(), // id -> {id, name, ws, role, dice, isAccomplice, ready, connected}
    hostId: null,
    nextPlayerId: 1,
    status: "lobby", // lobby -> confirm -> night -> day -> over
    nightRound: 0,
    nightTimer: null,
    stolen: false,
    accompliceStepDone: false,
    pendingAction: null, // { type: 'accomplice-choice'|'peek'|'assign', ... }
    votes: new Map(), // voterId -> targetId
    log: []
  };
  rooms.set(code, room);
  return room;
}

function destroyRoomIfEmpty(room) {
  const anyConnected = [...room.players.values()].some(p => p.connected);
  if (!anyConnected) {
    clearTimeout(room.nightTimer);
    rooms.delete(room.code);
  }
}

function pickRandomHostId(room) {
  const playerIds = [...room.players.keys()];
  if (!playerIds.length) return null;
  return playerIds[Math.floor(Math.random() * playerIds.length)];
}

function clearRoomTimer(room) {
  clearTimeout(room.nightTimer);
  room.nightTimer = null;
}

function resetRoomToLobby(room) {
  clearRoomTimer(room);
  room.status = "lobby";
  room.nightRound = 0;
  room.stolen = false;
  room.accompliceStepDone = false;
  room.pendingAction = null;
  room.votes = new Map();
  room.log = [];

  for (const player of room.players.values()) {
    player.role = null;
    player.dice = null;
    player.isAccomplice = false;
    player.ready = false;
  }
}

function startGame(room) {
  clearRoomTimer(room);
  const n = room.players.size;
  const roles = [ROLE.THIEF];
  while (roles.length < n) roles.push(ROLE.MOUSE);
  const shuffledRoles = shuffle(roles);

  let i = 0;
  for (const player of room.players.values()) {
    const role = shuffledRoles[i++];
    const dice = rollDice();
    player.role = role;
    player.dice = dice;
    player.isAccomplice = false;
    player.ready = false;
    send(player.ws, "roleAssigned", { role, dice });
  }

  room.status = "confirm";
  room.log = [];
  broadcast(room, "phaseChange", { phase: "confirm", durationMs: CONFIRM_PHASE_MS });
  room.nightTimer = setTimeout(() => startNightPhase(room), CONFIRM_PHASE_MS);
}

function startNightPhase(room) {
  room.status = "night";
  room.nightRound = 0;
  room.stolen = false;
  room.accompliceStepDone = room.players.size < 6;
  room.pendingAction = null;
  room.log = [];
  broadcast(room, "phaseChange", { phase: "night" });
  nightTick(room);
}

function nightTick(room) {
  clearRoomTimer(room);
  room.nightRound++;
  const round = room.nightRound;
  const waking = [...room.players.values()].filter(p => p.dice === round);
  const thief = waking.find(p => p.role === ROLE.THIEF);
  const mice = waking.filter(p => p.role === ROLE.MOUSE);
  const wakingNames = waking.map(p => p.name);

  broadcast(room, "nightRound", { round, durationMs: NIGHT_ROUND_MS });

  if (thief) {
    room.stolen = true;
    room.log.push(`第 ${round} 回合：奶酪大盜睜眼，奶酪已被偷走。`);
    send(thief.ws, "nightAction", {
      action: "steal",
      round,
      companions: wakingNames.filter(name => name !== thief.name),
      cheeseTaken: true
    });

    mice.forEach(mouse => {
      send(mouse.ws, "nightAction", {
        action: "witnessThief",
        round,
        companions: wakingNames.filter(name => name !== mouse.name),
        thiefName: thief.name,
        revealDelayMs: 3000,
        cheeseTaken: true
      });
    });

    if (room.players.size === 5) {
      const coincident = mice.filter(m => !m.isAccomplice);
      if (coincident.length === 1) {
        coincident[0].isAccomplice = true;
        room.log.push(`第 ${round} 回合：${coincident[0].name} 與大盜同時睜眼，成為共犯。`);
      } else if (coincident.length >= 2) {
        room.pendingAction = { type: "accomplice-choice", thiefId: thief.id, candidateIds: coincident.map(m => m.id) };
        send(thief.ws, "chooseAccomplicePrompt", {
          round,
          revealDelayMs: 3000,
          companions: wakingNames.filter(name => name !== thief.name),
          candidates: coincident.map(m => ({ id: m.id, name: m.name }))
        });
        return; // wait for thief's choice
      }
    }
    scheduleNextNightStep(room);
    return;
  }

  if (mice.length >= 2) {
    room.log.push(`第 ${round} 回合：${mice.map(m => m.name).join("、")} 同時睜眼，互相確認彼此身分。`);
    mice.forEach(m => {
      send(m.ws, "nightAction", {
        action: "mutual",
        round,
        names: mice.filter(x => x.id !== m.id).map(x => x.name),
        cheeseTaken: room.stolen
      });
    });
    scheduleNextNightStep(room);
    return;
  }

  if (mice.length === 1) {
    const mouse = mice[0];
    room.log.push(`第 ${round} 回合：${mouse.name} 獨自睜眼，可查看他人骰子。`);
    room.pendingAction = { type: "peek", mouseId: mouse.id };
    send(mouse.ws, "nightAction", {
      action: "peekPrompt",
      round,
      cheeseTaken: room.stolen,
      timeoutMs: SOLO_PEEK_TIMEOUT_MS,
      targets: [...room.players.values()].filter(p => p.id !== mouse.id).map(p => ({ id: p.id, name: p.name }))
    });
    room.nightTimer = setTimeout(() => {
      if (!room.pendingAction || room.pendingAction.type !== "peek" || room.pendingAction.mouseId !== mouse.id) return;
      room.log.push(`第 ${round} 回合：${mouse.name} 未在時限內查看骰子，直接略過。`);
      room.pendingAction = null;
      scheduleNextNightStep(room);
    }, SOLO_PEEK_TIMEOUT_MS);
    return; // wait for peek choice
  }

  room.log.push(`第 ${round} 回合：無人睜眼。`);
  scheduleNextNightStep(room);
}

function scheduleNextNightStep(room) {
  clearRoomTimer(room);
  if (room.nightRound >= 6) {
    room.nightTimer = setTimeout(() => {
      if (room.accompliceStepDone) {
        startDayPhase(room);
      } else {
        beginAccompliceAssignment(room);
      }
    }, NIGHT_ROUND_MS);
  } else {
    room.nightTimer = setTimeout(() => nightTick(room), NIGHT_ROUND_MS);
  }
}

function resolvePeek(room, mouseId, targetId) {
  if (!room.pendingAction || room.pendingAction.type !== "peek" || room.pendingAction.mouseId !== mouseId) return;
  const mouse = room.players.get(mouseId);
  const target = room.players.get(targetId);
  if (!mouse || !target || target.id === mouse.id) return;
  send(mouse.ws, "peekResult", { targetName: target.name, dice: target.dice });
  room.pendingAction = null;
  clearRoomTimer(room);
  scheduleNextNightStep(room);
}

function resolveAccompliceChoice(room, thiefId, targetId) {
  const action = room.pendingAction;
  if (!action || action.type !== "accomplice-choice" || action.thiefId !== thiefId) return;
  if (!action.candidateIds.includes(targetId)) return;
  const chosen = room.players.get(targetId);
  chosen.isAccomplice = true;
  room.log.push(`大盜指定 ${chosen.name} 成為共犯。`);
  room.pendingAction = null;
  scheduleNextNightStep(room);
}

function beginAccompliceAssignment(room) {
  clearRoomTimer(room);
  const n = room.players.size;
  const required = n === 6 ? 1 : 2;
  const thief = [...room.players.values()].find(p => p.role === ROLE.THIEF);
  const eligible = [...room.players.values()].filter(p => p.role === ROLE.MOUSE && !p.isAccomplice);
  room.pendingAction = { type: "assign", thiefId: thief.id, required };
  send(thief.ws, "assignAccomplicePrompt", { required, timeoutMs: NIGHT_ROUND_MS, candidates: eligible.map(p => ({ id: p.id, name: p.name })) });
  room.nightTimer = setTimeout(() => {
    if (!room.pendingAction || room.pendingAction.type !== "assign") return;
    room.log.push("大盜未在時限內指定共犯，本局不新增共犯。");
    room.pendingAction = null;
    room.accompliceStepDone = true;
    room.nightTimer = setTimeout(() => startDayPhase(room), PHASE_TRANSITION_MS);
  }, NIGHT_ROUND_MS);
}

function resolveAccompliceAssign(room, thiefId, targetIds) {
  const action = room.pendingAction;
  if (!action || action.type !== "assign" || action.thiefId !== thiefId) return;
  const uniqueIds = [...new Set(targetIds)].filter(id => room.players.has(id));
  if (uniqueIds.length !== action.required) return;

  const n = room.players.size;
  const thief = room.players.get(thiefId);
  const chosenPlayers = uniqueIds.map(id => room.players.get(id));
  chosenPlayers.forEach(p => { p.isAccomplice = true; });
  room.log.push(`大盜指定 ${chosenPlayers.map(p => p.name).join("、")} 成為共犯。`);

  chosenPlayers.forEach(acc => {
    const partners = chosenPlayers.filter(p => p.id !== acc.id).map(p => p.name);
    if (n === 6 || n === 8) {
      send(acc.ws, "accompliceReveal", { thiefName: thief.name, partners });
    } else if (n === 7) {
      send(acc.ws, "accompliceReveal", { thiefName: null, partners });
    }
  });

  room.pendingAction = null;
  room.accompliceStepDone = true;
  clearRoomTimer(room);
  room.nightTimer = setTimeout(() => startDayPhase(room), PHASE_TRANSITION_MS);
}


function startDayPhase(room) {
  clearRoomTimer(room);
  room.status = "day";
  room.votes = new Map();
  broadcast(room, "dayStart", { stolen: room.stolen });
}

function registerVote(room, voterId, targetId) {
  if (room.status !== "day") return;
  if (!room.players.has(targetId) || targetId === voterId) return;
  room.votes.set(voterId, targetId);
  const votedCount = room.votes.size;
  const total = room.players.size;
  broadcast(room, "voteProgress", { votedCount, total });
  if (votedCount >= total) {
    finishVoting(room);
  }
}

function finishVoting(room) {
  const tally = {};
  for (const player of room.players.values()) tally[player.id] = 0;
  for (const targetId of room.votes.values()) {
    tally[targetId] = (tally[targetId] || 0) + 1;
  }

  let maxVotes = -1;
  let topIds = [];
  Object.keys(tally).forEach(idStr => {
    const id = parseInt(idStr, 10);
    const v = tally[id];
    if (v > maxVotes) {
      maxVotes = v;
      topIds = [id];
    } else if (v === maxVotes) {
      topIds.push(id);
    }
  });

  // 翻開最高票玩家的身分卡：只要其中有奶酪大盜，貪睡鼠陣營獲勝；否則大盜與共犯獲勝
  const mouseWin = topIds.some(id => room.players.get(id).role === ROLE.THIEF);

  room.status = "over";
  const playersReveal = [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    role: p.isAccomplice ? "共犯" : p.role,
    dice: p.dice,
    votes: tally[p.id] || 0
  }));

  broadcast(room, "gameOver", { mouseWin, topIds, tally, players: playersReveal, log: room.log });
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case "listRooms": {
      const list = [...rooms.values()]
        .filter(r => r.status === "lobby" && r.players.size < MAX_PLAYERS)
        .map(publicRoomSummary);
      send(ws, "roomList", { rooms: list });
      break;
    }
    case "findRoom": {
      const room = rooms.get(msg.code);
      if (!room) {
        send(ws, "error", { message: "找不到此房號" });
        return;
      }
      send(ws, "roomFound", { code: room.code, isPublic: room.isPublic, maxPlayers: MAX_PLAYERS, currentPlayers: room.players.size, status: room.status });
      break;
    }
    case "createRoom": {
      const playerName = String(msg.playerName || "").trim().slice(0, 20);
      if (!playerName) {
        send(ws, "error", { message: "請輸入暱稱" });
        return;
      }
      const isPublic = !!msg.isPublic;
      const password = isPublic ? null : String(msg.password || "").slice(0, 40);
      if (!isPublic && !password) {
        send(ws, "error", { message: "非公開房間請設定密碼" });
        return;
      }

      const room = createRoom({ isPublic, password });
      const player = { id: room.nextPlayerId++, name: playerName, ws, role: null, dice: null, ready: false, connected: true };
      room.players.set(player.id, player);
      room.hostId = player.id;
      ws.roomCode = room.code;
      ws.playerId = player.id;

      send(ws, "roomJoined", { room: lobbySummary(room), yourId: player.id, isHost: true });
      break;
    }
    case "joinRoom": {
      const room = rooms.get(msg.code);
      if (!room) {
        send(ws, "error", { message: "找不到此房號" });
        return;
      }
      if (room.status !== "lobby") {
        send(ws, "error", { message: "此房間已開始遊戲" });
        return;
      }
      if (room.players.size >= MAX_PLAYERS) {
        send(ws, "error", { message: "房間人數已滿" });
        return;
      }
      if (!room.isPublic && String(msg.password || "") !== room.password) {
        send(ws, "error", { message: "密碼錯誤" });
        return;
      }

      const playerName = String(msg.playerName || "").trim().slice(0, 20);
      if (!playerName) {
        send(ws, "error", { message: "請輸入暱稱" });
        return;
      }
      const player = { id: room.nextPlayerId++, name: playerName, ws, role: null, dice: null, ready: false, connected: true };
      room.players.set(player.id, player);
      ws.roomCode = room.code;
      ws.playerId = player.id;

      send(ws, "roomJoined", { room: lobbySummary(room), yourId: player.id, isHost: player.id === room.hostId });
      broadcast(room, "roomUpdate", { room: lobbySummary(room) }, player.id);
      break;
    }
    case "leaveRoom": {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      room.players.delete(ws.playerId);
      if (room.hostId === ws.playerId) {
        room.hostId = pickRandomHostId(room);
      }
      broadcast(room, "roomUpdate", { room: lobbySummary(room) });
      destroyRoomIfEmpty(room);
      ws.roomCode = null;
      ws.playerId = null;
      break;
    }
    case "restartRoom": {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      if (room.status === "over") {
        resetRoomToLobby(room);
        broadcast(room, "roomUpdate", { room: lobbySummary(room) });
      } else if (room.status === "lobby") {
        send(ws, "roomUpdate", { room: lobbySummary(room) });
      }
      break;
    }
    case "startGame": {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      if (room.hostId !== ws.playerId) {
        send(ws, "error", { message: "只有房主可以開始遊戲" });
        return;
      }
      if (room.players.size < MIN_PLAYERS || room.players.size > MAX_PLAYERS) {
        send(ws, "error", { message: `房間需要 ${MIN_PLAYERS}-${MAX_PLAYERS} 位玩家才能開始` });
        return;
      }
      startGame(room);
      break;
    }
    case "ackReady": {
      break;
    }
    case "vote": {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      registerVote(room, ws.playerId, parseInt(msg.targetId, 10));
      break;
    }
    case "peekChoose": {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      resolvePeek(room, ws.playerId, parseInt(msg.targetId, 10));
      break;
    }
    case "chooseAccomplice": {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      resolveAccompliceChoice(room, ws.playerId, parseInt(msg.targetId, 10));
      break;
    }
    case "assignAccomplice": {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const targetIds = Array.isArray(msg.targetIds) ? msg.targetIds.map(id => parseInt(id, 10)) : [];
      resolveAccompliceAssign(room, ws.playerId, targetIds);
      break;
    }
    default:
      send(ws, "error", { message: "未知的指令" });
  }
}

function handleClose(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;

  if (room.status === "lobby") {
    room.players.delete(ws.playerId);
    if (room.hostId === ws.playerId) {
      room.hostId = pickRandomHostId(room);
    }
    broadcast(room, "roomUpdate", { room: lobbySummary(room) });
  } else {
    player.connected = false;
  }
  destroyRoomIfEmpty(room);
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      send(ws, "error", { message: "訊息格式錯誤" });
      return;
    }
    try {
      handleMessage(ws, msg);
    } catch (e) {
      send(ws, "error", { message: "伺服器發生錯誤" });
    }
  });
  ws.on("close", () => handleClose(ws));
});

server.listen(PORT, () => {
  console.log(`奶酪大盜 伺服器已啟動： http://localhost:${PORT}`);
});

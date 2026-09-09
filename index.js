const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const app = express();

app.use(express.static("public"));
app.set("view engine", "pug");

const PORT = process.env.PORT || 3000;

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

const httpServer = createServer(app);
const io = new Server(httpServer);

const tabooWords = JSON.parse(
  fs.readFileSync(path.join(__dirname, "public/data/taboo-words.json"), "utf8")
);

let ruotaFrasi = [];
try {
  ruotaFrasi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "public/data/ruota-frasi.json"), "utf8")
  );
} catch (e) {
  console.error("Impossibile caricare ruota-frasi.json:", e.message);
  ruotaFrasi = [];
}
if (!Array.isArray(ruotaFrasi) || ruotaFrasi.length === 0) {
  ruotaFrasi = [
    { titolo: "IL PESCE NAPOLEONE", frase: "GOBBA SULLA TESTA CHE RICORDA IL SUO CAPPELLO" }
  ];
}

const tabooRooms = new Map();
const ruotaRooms = new Map();

app.param("mode", (req, res, next, mode) => {
  if (mode == "default" || mode == "buttons") {
    next();
  } else {
    res.redirect("/game/" + req.params.uuid);
  }
});

app.use("/game/:uuid/:mode", (req, res) => {
  res.render("game", { gameID: req.params.uuid, mode: req.params.mode });
});

app.use("/game/:uuid/", (req, res) => {
  res.render("game", { gameID: req.params.uuid });
});

app.use("/game", (_, res) => {
  const gameID = uuidv4();
  res.redirect("/game/" + gameID);
});

app.use("/taboo/:uuid/", (req, res) => {
  res.render("taboo/game", { gameID: req.params.uuid });
});

// // Route per la schermata di vittoria
// app.use("/taboo/victory/:uuid/:winner", (req, res) => {
//   res.render("taboo/victory", {
//     gameID: req.params.uuid,
//     winner: decodeURIComponent(req.params.winner)
//   });
// });

app.use("/taboo", (_, res) => {
  const roomID = uuidv4();
  res.redirect("/taboo/" + roomID);
});

app.use("/ruota/:uuid/", (req, res) => {
  res.render("ruota/game", { gameID: req.params.uuid });
});

app.use("/ruota", (_, res) => {
  const roomID = uuidv4();
  res.redirect("/ruota/" + roomID);
});

app.use("/", (_, res) => {
  res.render("select");
});

function getRandomTabooWord(usedWords) {
  const available = tabooWords.filter((w) => !usedWords.includes(w.word));
  if (available.length === 0) {
    usedWords.length = 0;
  }
  const pool = available.length === 0 ? tabooWords : available;
  const word = pool[Math.floor(Math.random() * pool.length)];
  usedWords.push(word.word);
  return word;
}

const TABOO_LOBBY_GRACE_MS = 120 * 1000;

function initializeTabooRoom(roomID) {
  tabooRooms.set(roomID, {
    roomID,
    players: [],
    teams: {
      rossa: { score: 0, descriptorIndex: 0, players: [] },
      blu: { score: 0, descriptorIndex: 0, players: [] }
    },
    currentTurn: "rossa",
    currentDescriptorId: null,
    currentWord: null,
    usedWords: [],
    roundNumber: 1,
    totalRounds: 4,
    timer: 120,
    timerInterval: null,
    turnTransitioning: false,
    gameState: "lobby",
    pauseReason: null,
    winner: null,
    // socket.id -> playerId persistente (per socket non ancora associati a un player)
    pendingPlayerIds: {},
    // playerId -> timeout di cleanup (solo lobby/ended)
    cleanupTimers: {}
  });
}

function getPlayerBySocket(room, socketId) {
  if (!room || !socketId) return null;
  return room.players.find((p) => p.socketId === socketId) || null;
}

function getPlayerById(room, playerId) {
  if (!room || !playerId) return null;
  return room.players.find((p) => p.id === playerId) || null;
}

// True se il socket risulta ancora vivo sul server (per evitare steal tra tab aperti).
function isTabooSocketAlive(socketId) {
  try {
    if (!socketId) return false;
    const m = io && io.sockets && io.sockets.sockets;
    if (!m) return false;
    if (typeof m.has === "function") return m.has(socketId);
    if (typeof m.get === "function") return !!m.get(socketId);
    return !!m[socketId];
  } catch (e) {
    return false;
  }
}

// Risolve il player della connessione corrente: prima per socketId,
// poi per playerId esplicito del client, poi per pending map.
// Non ruba mai una sessione ancora viva: in quel caso ritorna null
// così il secondo tab potrà essere trattato come nuovo giocatore.
function resolveTabooPlayer(room, socket, clientPlayerId) {
  if (!room) return null;
  let player = getPlayerBySocket(room, socket.id);
  if (player) return player;
  const pendingId = room.pendingPlayerIds
    ? room.pendingPlayerIds[socket.id]
    : null;
  const wantedId = clientPlayerId || pendingId;
  if (wantedId) {
    player = getPlayerById(room, wantedId);
    if (player) {
      if (
        player.connected &&
        player.socketId &&
        player.socketId !== socket.id &&
        isTabooSocketAlive(player.socketId)
      ) {
        return null;
      }
      // Ricollega socket se il player era offline (last-socket-wins)
      clearTabooCleanupTimer(room, player.id);
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      return player;
    }
  }
  return null;
}

function clearTabooCleanupTimer(room, playerId) {
  if (room.cleanupTimers && room.cleanupTimers[playerId]) {
    clearTimeout(room.cleanupTimers[playerId]);
    delete room.cleanupTimers[playerId];
  }
}

function scheduleTabooLobbyCleanup(roomID, playerId) {
  const room = tabooRooms.get(roomID);
  if (!room) return;
  // Nessun purge durante la partita: lo slot resta riservato fino a tabooReset.
  if (room.gameState === "playing" || room.gameState === "paused") return;
  clearTabooCleanupTimer(room, playerId);
  room.cleanupTimers[playerId] = setTimeout(() => {
    const r = tabooRooms.get(roomID);
    if (!r) return;
    // Se nel frattempo è iniziata la partita, non purgare.
    if (r.gameState === "playing" || r.gameState === "paused") {
      delete r.cleanupTimers[playerId];
      return;
    }
    const player = getPlayerById(r, playerId);
    if (!player || player.connected) {
      delete r.cleanupTimers[playerId];
      return;
    }
    if (player.team && r.teams[player.team]) {
      r.teams[player.team].players = r.teams[player.team].players.filter(
        (p) => p.id !== playerId
      );
    }
    r.players = r.players.filter((p) => p.id !== playerId);
    delete r.cleanupTimers[playerId];
    broadcastTabooState(r);
  }, TABOO_LOBBY_GRACE_MS);
}

function getCurrentDescriptorId(room) {
  const teamPlayers = room.teams[room.currentTurn].players;
  if (teamPlayers.length === 0) return null;
  const index = room.teams[room.currentTurn].descriptorIndex % teamPlayers.length;
  return teamPlayers[index]?.id;
}

function startNewTurn(room) {
  room.currentDescriptorId = getCurrentDescriptorId(room);
  const word = getRandomTabooWord(room.usedWords);
  room.currentWord = word;
  room.timer = 120;
  return { currentDescriptorId: room.currentDescriptorId, currentWord: word };
}

function serializeRoom(room) {
  const serializePlayer = (p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    ready: p.ready,
    connected: p.connected !== false
  });
  return {
    roomID: room.roomID,
    players: room.players.map(serializePlayer),
    teams: {
      rossa: { score: room.teams.rossa.score, players: room.teams.rossa.players.map(serializePlayer) },
      blu: { score: room.teams.blu.score, players: room.teams.blu.players.map(serializePlayer) }
    },
    currentTurn: room.currentTurn,
    currentDescriptorId: room.currentDescriptorId,
    currentWord: room.currentWord,
    roundNumber: room.roundNumber,
    totalRounds: room.totalRounds,
    timer: room.timer,
    gameState: room.gameState,
    pauseReason: room.pauseReason || null,
    winner: room.winner,
    rossaScore: room.teams.rossa.score,
    bluScore: room.teams.blu.score
  };
}

function broadcastTabooState(room, sound = null) {
  const payload = serializeRoom(room);
  if (sound) payload.sound = sound;
  io.to(room.roomID).emit("tabooState", payload);
}

function startServerTimer(roomID, reset = true) {
  const room = tabooRooms.get(roomID);
  if (!room) return;

  if (room.timerInterval) {
    clearInterval(room.timerInterval);
  }

  if (reset) {
    room.timer = 120;
  }

  room.timerInterval = setInterval(() => {
    if (room.gameState !== "playing") {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      return;
    }

    room.timer--;
    io.to(roomID).emit("tabooTimerTick", room.timer);

    if (room.timer <= 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      handleTurnEnd(roomID);
    }
  }, 1000);
}

function stopServerTimer(room) {
  if (!room) return;
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
}

function handleTurnEnd(roomID) {
  const room = tabooRooms.get(roomID);
  if (!room) return;
  if (room.turnTransitioning) return;
  room.turnTransitioning = true;

  const previousTurn = room.currentTurn;
  room.currentTurn = previousTurn === "rossa" ? "blu" : "rossa";

  if (previousTurn === "blu") {
    room.teams.rossa.descriptorIndex = (room.teams.rossa.descriptorIndex + 1) % room.teams.rossa.players.length;
    room.teams.blu.descriptorIndex = (room.teams.blu.descriptorIndex + 1) % room.teams.blu.players.length;
    room.roundNumber++;

    if (room.roundNumber > room.totalRounds) {
      room.gameState = "ended";
      room.turnTransitioning = false;

      const winner = room.teams.rossa.score > room.teams.blu.score 
        ? "Squadra Rossa" 
        : room.teams.blu.score > room.teams.rossa.score 
          ? "Squadra Blu" 
          : "Pareggio";

      room.winner = winner;
      broadcastTabooState(room, "gong");
      return;
    }
  }

  // Nuovo turno: parola preparata ma nascosta, gioco in pausa finché
  // il nuovo descrittore preme "Riprendi". Il timer parte solo al resume.
  stopServerTimer(room);
  startNewTurn(room);
  room.gameState = "paused";
  room.pauseReason = "turnChange";
  room.turnTransitioning = false;
  broadcastTabooState(room, "gong");
}

function checkCanStartGame(room) {
  if (room.gameState !== "lobby") return false;
  if (room.players.length !== 4) return false;

  // Tutti devono essere connessi: i player offline restano in lista
  // per il grace period ma non devono far partire la partita.
  const allConnected = room.players.every((p) => p.connected !== false);
  if (!allConnected) return false;

  const allReady = room.players.every((p) => p.ready);
  const rossaCount = room.teams.rossa.players.filter((p) => p.connected !== false).length;
  const bluCount = room.teams.blu.players.filter((p) => p.connected !== false).length;

  return allReady && rossaCount === 2 && bluCount === 2;
}

// ==================== RUOTA DELLA FORTUNA ====================

const RUOTA_VOWELS = ["A", "E", "I", "O", "U"];
const RUOTA_VOWEL_COST = 500;
const RUOTA_TOTAL_ROUNDS = 4;
const RUOTA_MIN_ROUND_PRIZE = 1000;

// Ruota fissa da 24 caselle:
// pos 0 e 12 = BANCAROTTA (opposte), pos 6 e 18 = PASSAMANO (opposte),
// pos 1 = SPECIALE (accanto a bancarotta pos 0, valore 1000*round).
const RUOTA_WHEEL_BASE = [
  { type: "bancarotta" }, // 0
  { type: "special" }, // 1
  { type: "money", value: 100 }, // 2
  { type: "money", value: 300 }, // 3
  { type: "money", value: 200 }, // 4
  { type: "money", value: 500 }, // 5
  { type: "passamano" }, // 6
  { type: "money", value: 400 }, // 7
  { type: "money", value: 200 }, // 8
  { type: "money", value: 600 }, // 9
  { type: "money", value: 300 }, // 10
  { type: "money", value: 500 }, // 11
  { type: "bancarotta" }, // 12
  { type: "money", value: 700 }, // 13
  { type: "money", value: 200 }, // 14
  { type: "money", value: 800 }, // 15
  { type: "money", value: 300 }, // 16
  { type: "money", value: 600 }, // 17
  { type: "passamano" }, // 18
  { type: "money", value: 500 }, // 19
  { type: "money", value: 400 }, // 20
  { type: "money", value: 700 }, // 21
  { type: "money", value: 100 }, // 22
  { type: "money", value: 800 } // 23
];

function ruotaIsLetter(ch) {
  return /[A-ZÀ-Þ]/i.test(ch || "");
}

function ruotaNormalizeText(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function ruotaGetPhrase(roundNumber) {
  const idx = (roundNumber - 1) % ruotaFrasi.length;
  const raw = ruotaFrasi[idx] || ruotaFrasi[0];
  const titolo = String(raw.titolo || "FRASE MISTERIOSA").toUpperCase();
  let frase = String(raw.frase || "").toUpperCase();
  // Sicurezza: max 52 caratteri inclusi spazi per non sforare il tabellone
  if (frase.length > 52) frase = frase.slice(0, 52);
  return { titolo, frase };
}

function ruotaBuildRevealed(frase) {
  return Array.from(frase).map((ch) => !ruotaIsLetter(ch));
}

function ruotaCountUnrevealed(room) {
  let n = 0;
  const frase = room.phrase.frase;
  for (let i = 0; i < frase.length; i++) {
    if (ruotaIsLetter(frase[i]) && !room.revealed[i]) n++;
  }
  return n;
}

function ruotaRevealLetter(room, letter) {
  const frase = room.phrase.frase;
  let count = 0;
  for (let i = 0; i < frase.length; i++) {
    if (frase[i] === letter && !room.revealed[i]) {
      room.revealed[i] = true;
      count++;
    }
  }
  return count;
}

function ruotaGetWheelLabels(roundNumber) {
  const specialValue = roundNumber * 1000;
  return RUOTA_WHEEL_BASE.map((c, index) => {
    if (c.type === "bancarotta") return { index, type: "bancarotta", label: "BANCAROTTA" };
    if (c.type === "passamano") return { index, type: "passamano", label: "PASSA" };
    if (c.type === "special") return { index, type: "money", special: true, value: specialValue, label: String(specialValue) };
    return { index, type: "money", value: c.value, label: String(c.value) };
  });
}

function initializeRuotaRoom(roomID) {
  ruotaRooms.set(roomID, {
    roomID,
    players: [],
    currentPlayerIndex: 0,
    starterIndex: 0,
    roundNumber: 1,
    totalRounds: RUOTA_TOTAL_ROUNDS,
    phrase: ruotaGetPhrase(1),
    revealed: ruotaBuildRevealed(ruotaGetPhrase(1).frase),
    calledLetters: [],
    pendingValue: null,
    pendingSpinIndex: null,
    lastSpin: null,
    spinNonce: 0,
    lastBanked: null,
    phase: "lobby",
    winner: null,
    pendingPlayerIds: {},
    cleanupTimers: {}
  });
}

function ruotaGetPlayerBySocket(room, socketId) {
  if (!room || !socketId) return null;
  return room.players.find((p) => p.socketId === socketId) || null;
}

function ruotaGetPlayerById(room, playerId) {
  if (!room || !playerId) return null;
  return room.players.find((p) => p.id === playerId) || null;
}

function ruotaResolvePlayer(room, socket, clientPlayerId) {
  if (!room) return null;
  let player = ruotaGetPlayerBySocket(room, socket.id);
  if (player) return player;
  const pendingId = room.pendingPlayerIds ? room.pendingPlayerIds[socket.id] : null;
  const wantedId = clientPlayerId || pendingId;
  if (wantedId) {
    player = ruotaGetPlayerById(room, wantedId);
    if (player) {
      if (player.connected && player.socketId && player.socketId !== socket.id && isTabooSocketAlive(player.socketId)) {
        return null;
      }
      ruotaClearCleanupTimer(room, player.id);
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      return player;
    }
  }
  return null;
}

function ruotaClearCleanupTimer(room, playerId) {
  if (room.cleanupTimers && room.cleanupTimers[playerId]) {
    clearTimeout(room.cleanupTimers[playerId]);
    delete room.cleanupTimers[playerId];
  }
}

function ruotaScheduleLobbyCleanup(roomID, playerId) {
  const room = ruotaRooms.get(roomID);
  if (!room) return;
  if (room.phase === "playing" || room.phase === "roundEnd") return;
  ruotaClearCleanupTimer(room, playerId);
  room.cleanupTimers[playerId] = setTimeout(() => {
    const r = ruotaRooms.get(roomID);
    if (!r) return;
    if (r.phase === "playing" || r.phase === "roundEnd") {
      delete r.cleanupTimers[playerId];
      return;
    }
    const player = ruotaGetPlayerById(r, playerId);
    if (!player || player.connected) {
      delete r.cleanupTimers[playerId];
      return;
    }
    r.players = r.players.filter((p) => p.id !== playerId);
    if (r.currentPlayerIndex >= r.players.length) r.currentPlayerIndex = 0;
    if (r.starterIndex >= r.players.length) r.starterIndex = 0;
    delete r.cleanupTimers[playerId];
    broadcastRuotaState(r);
  }, TABOO_LOBBY_GRACE_MS);
}

function ruotaAdvanceTurn(room) {
  if (room.players.length === 0) return;
  room.pendingValue = null;
  room.pendingSpinIndex = null;
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
}

function ruotaStartRound(room, roundNumber, starterIndex) {
  room.roundNumber = roundNumber;
  room.starterIndex = starterIndex % Math.max(1, room.players.length);
  room.currentPlayerIndex = room.starterIndex;
  room.phrase = ruotaGetPhrase(roundNumber);
  room.revealed = ruotaBuildRevealed(room.phrase.frase);
  room.calledLetters = [];
  room.pendingValue = null;
  room.pendingSpinIndex = null;
  room.lastSpin = null;
  room.lastBanked = null;
  room.phase = "playing";
  room.winner = null;
  room.players.forEach((p) => {
    p.roundPot = 0;
  });
}

// Accredita il montepremi del round nella banca del giocatore:
// chi vince il round porta a casa almeno RUOTA_MIN_ROUND_PRIZE.
// Registra l'importo in room.lastBanked per mostrarlo nella UI.
function ruotaBankRoundPot(room, actor) {
  const banked = Math.max(actor.roundPot || 0, RUOTA_MIN_ROUND_PRIZE);
  actor.totalPot = (actor.totalPot || 0) + banked;
  actor.roundPot = 0;
  room.lastBanked = { amount: banked, playerId: actor.id, playerName: actor.name, round: room.roundNumber };
  return banked;
}

function ruotaComputeWinner(room) {
  if (room.players.length === 0) return null;
  let best = room.players[0];
  let tie = false;
  for (let i = 1; i < room.players.length; i++) {
    if (room.players[i].totalPot > best.totalPot) {
      best = room.players[i];
      tie = false;
    } else if (room.players[i].totalPot === best.totalPot) {
      tie = true;
    }
  }
  if (tie) {
    const top = Math.max(...room.players.map((p) => p.totalPot));
    const names = room.players.filter((p) => p.totalPot === top).map((p) => p.name);
    return { tie: true, names, totalPot: top, text: "Pareggio tra " + names.join(", ") };
  }
  return { tie: false, playerId: best.id, name: best.name, totalPot: best.totalPot, text: best.name };
}

function serializeRuotaRoom(room) {
  return {
    roomID: room.roomID,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: !!p.ready,
      connected: p.connected !== false,
      roundPot: p.roundPot || 0,
      totalPot: p.totalPot || 0
    })),
    currentPlayerId: room.players.length > 0 ? room.players[room.currentPlayerIndex % room.players.length].id : null,
    roundNumber: room.roundNumber,
    totalRounds: room.totalRounds,
    titolo: room.phrase.titolo,
    fraseLength: room.phrase.frase.length,
    // La frase viene inviata a tutti: il tabellone è visibile a tutti i giocatori
    frase: room.phrase.frase,
    revealed: room.revealed,
    calledLetters: room.calledLetters,
    pendingValue: room.pendingValue,
    pendingSpinIndex: room.pendingSpinIndex,
    lastSpin: room.lastSpin,
    lastBanked: room.lastBanked,
    wheel: ruotaGetWheelLabels(room.roundNumber),
    specialValue: room.roundNumber * 1000,
    vowelCost: RUOTA_VOWEL_COST,
    phase: room.phase,
    winner: room.winner
  };
}

function broadcastRuotaState(room, sound = null) {
  const payload = serializeRuotaRoom(room);
  if (sound) payload.sound = sound;
  io.to(room.roomID).emit("ruotaState", payload);
}

function checkRuotaCanStart(room) {
  if (room.phase !== "lobby") return false;
  if (room.players.length < 2 || room.players.length > 4) return false;
  const allConnected = room.players.every((p) => p.connected !== false);
  if (!allConnected) return false;
  const allReady = room.players.every((p) => p.ready && p.name);
  return allReady;
}

io.on("connection", (socket) => {
  socket.on("getGameStatus", (gameID) => {
    socket.join(gameID);
    socket.to(gameID).emit("getGameStatus");
  });

  socket.on("setGameStatus", (gameID, data) => {
    socket.to(gameID).emit("setGameStatus", data);
  });

  socket.on("updateStatus", (gameID, command, data) => {
    socket.to(gameID).emit("updateStatus", command, data);
  });

  socket.on("tabooJoinRoom", (roomID, persistedPlayerId) => {
    if (!roomID) return;
    socket.join(roomID);

    if (!tabooRooms.has(roomID)) {
      initializeTabooRoom(roomID);
    }

    const room = tabooRooms.get(roomID);
    const cleanPersistedId =
      typeof persistedPlayerId === "string" && persistedPlayerId.trim()
        ? persistedPlayerId.trim().slice(0, 64)
        : null;

    let player = cleanPersistedId ? getPlayerById(room, cleanPersistedId) : null;

    if (player) {
      // Se la sessione è ancora viva su un altro socket (secondo tab stesso browser),
      // non rubare l'identità: assegna un nuovo id a questo socket.
      if (
        player.connected &&
        player.socketId &&
        player.socketId !== socket.id &&
        isTabooSocketAlive(player.socketId)
      ) {
        const freshId = uuidv4();
        room.pendingPlayerIds[socket.id] = freshId;
        socket.emit("tabooRoomJoined", {
          roomID,
          socketId: socket.id,
          playerId: freshId
        });
        socket.emit("tabooState", serializeRoom(room));
        return;
      }
      // Rejoin: ricollega il nuovo socket all'identità persistente (last-socket-wins).
      // Non toccare timer/gameState: il gioco continua senza pause automatiche.
      clearTabooCleanupTimer(room, player.id);
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      room.pendingPlayerIds[socket.id] = player.id;
      socket.emit("tabooRoomJoined", {
        roomID,
        socketId: socket.id,
        playerId: player.id
      });
      // Notifica anche gli altri: il badge offline deve sparire per tutti.
      broadcastTabooState(room);
      return;
    }
    // Prima connessione (o id sconosciuto): genera l'id sul server.
    // Se il client ha inviato un id mai visto (es. room appena creata),
    // lo adottiamo per stabilità; altrimenti ne generiamo uno nuovo.
    const assignedId = cleanPersistedId || uuidv4();
    room.pendingPlayerIds[socket.id] = assignedId;
    socket.emit("tabooRoomJoined", {
      roomID,
      socketId: socket.id,
      playerId: assignedId
    });
    socket.emit("tabooState", serializeRoom(room));
  });

  socket.on("tabooSetName", (roomID, name, clientPlayerId) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    const playerName = String(name || "").trim().slice(0, 20) || "Giocatore";

    let player = resolveTabooPlayer(room, socket, clientPlayerId);
    if (!player) {
      const pendingId = room.pendingPlayerIds[socket.id];
      const wantedId =
        (typeof clientPlayerId === "string" && clientPlayerId.trim()) ||
        pendingId ||
        uuidv4();
      const cleanId = String(wantedId).slice(0, 64);
      if (room.players.length >= 4 && !getPlayerById(room, cleanId)) {
        socket.emit("tabooError", "La stanza è piena (max 4 giocatori).");
        return;
      }
      player = {
        id: cleanId,
        socketId: socket.id,
        name: playerName,
        team: null,
        ready: false,
        connected: true,
        disconnectedAt: null
      };
      room.players.push(player);
      room.pendingPlayerIds[socket.id] = player.id;
    } else {
      player.name = playerName;
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      clearTabooCleanupTimer(room, player.id);
    }

    broadcastTabooState(room);
  });

  socket.on("tabooSetTeam", (roomID, team, clientPlayerId) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;
    if (team !== "rossa" && team !== "blu") return;

    const player = resolveTabooPlayer(room, socket, clientPlayerId);
    if (!player) return;

    // Conta solo i connessi + chi è in grace period con slot riservato:
    // lo slot di un player offline resta riservato, un nuovo player non può rubarlo.
    const teamPlayers = room.teams[team].players;
    const occupiedByOthers = teamPlayers.filter((p) => p.id !== player.id).length;
    if (occupiedByOthers >= 2 && player.team !== team) {
      socket.emit("tabooError", "La squadra è già piena (max 2 giocatori).");
      return;
    }

    const previousTeam = player.team;
    if (previousTeam && previousTeam !== team) {
      room.teams[previousTeam].players = room.teams[previousTeam].players.filter(
        (p) => p.id !== player.id
      );
    }

    player.team = team;
    if (!room.teams[team].players.some((p) => p.id === player.id)) {
      room.teams[team].players.push(player);
    }

    broadcastTabooState(room);

    // Invia la squadra assegnata al client per aggiornare myTeam
    socket.emit("tabooSetTeamResponse", team);
  });

  socket.on("tabooSetReady", (roomID, ready, clientPlayerId) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    const player = resolveTabooPlayer(room, socket, clientPlayerId);
    if (!player) return;

    player.ready = !!ready;

    broadcastTabooState(room);

    if (checkCanStartGame(room)) {
      room.gameState = "playing";
      startNewTurn(room);
      broadcastTabooState(room, "gong");
      startServerTimer(roomID);
    }
  });

  socket.on("tabooCorrectAnswer", (roomID, clientPlayerId) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;
    const actor = resolveTabooPlayer(room, socket, clientPlayerId);
    if (!actor || actor.id !== room.currentDescriptorId) {
      socket.emit("tabooError", "Solo il descrittore può segnare un punto.");
      return;
    }

    room.teams[room.currentTurn].score++;

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    broadcastTabooState(room, "correct");
  });

  socket.on("tabooSkipWord", (roomID, clientPlayerId) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;
    const actor = resolveTabooPlayer(room, socket, clientPlayerId);
    if (!actor || actor.id !== room.currentDescriptorId) {
      socket.emit("tabooError", "Solo il descrittore può saltare una parola.");
      return;
    }

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    broadcastTabooState(room);
  });

  socket.on("tabooSignalTaboo", (roomID, clientPlayerId) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;

    const player = resolveTabooPlayer(room, socket, clientPlayerId);
    if (!player || !player.team || player.team === room.currentTurn) {
      socket.emit("tabooError", "Solo la squadra avversaria può segnalare un taboo.");
      return;
    }

    room.teams[room.currentTurn].score = Math.max(0, room.teams[room.currentTurn].score - 1);

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    broadcastTabooState(room, "wrong");
  });

  socket.on("tabooNextTurn", (roomID, clientPlayerId) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;
    const actor = resolveTabooPlayer(room, socket, clientPlayerId);
    if (!actor || actor.id !== room.currentDescriptorId) {
      socket.emit("tabooError", "Solo il descrittore può terminare il turno.");
      return;
    }

    stopServerTimer(room);
    handleTurnEnd(roomID);
  });

  socket.on("tabooPause", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;
    if (room.gameState !== "playing") return;

    stopServerTimer(room);
    room.gameState = "paused";
    room.pauseReason = "manual";
    broadcastTabooState(room);
  });

  socket.on("tabooResume", (roomID, clientPlayerId) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "paused") return;

    // Pausa da cambio turno: solo il nuovo descrittore può far partire
    // il timer e mostrare la parola. Pausa manuale: chiunque può riprendere.
    if (room.pauseReason === "turnChange") {
      const actor = resolveTabooPlayer(room, socket, clientPlayerId);
      if (!actor || actor.id !== room.currentDescriptorId) {
        socket.emit("tabooError", "Solo il descrittore può avviare il turno.");
        return;
      }
    }

    room.gameState = "playing";
    room.pauseReason = null;
    broadcastTabooState(room);
    startServerTimer(roomID, false);
  });

  socket.on("tabooReset", (roomID) => {
    const oldRoom = tabooRooms.get(roomID);
    if (oldRoom) {
      stopServerTimer(oldRoom);
      Object.values(oldRoom.cleanupTimers || {}).forEach(clearTimeout);
    }

    const players = oldRoom ? oldRoom.players : [];
    initializeTabooRoom(roomID);

    const room = tabooRooms.get(roomID);
    // Preserva identità persistente; riconnetti lo stato socket se ancora online.
    room.players = players.map((p) => ({
      ...p,
      ready: false,
      connected: p.connected !== false ? true : false
    }));
    room.players.forEach((p) => {
      if (p.team && room.teams[p.team]) {
        room.teams[p.team].players.push(p);
      }
    });

    broadcastTabooState(room);
  });

  // ---------- RUOTA DELLA FORTUNA ----------
  socket.on("ruotaJoinRoom", (roomID, persistedPlayerId) => {
    if (!roomID) return;
    socket.join(roomID);
    if (!ruotaRooms.has(roomID)) initializeRuotaRoom(roomID);
    const room = ruotaRooms.get(roomID);
    const cleanPersistedId =
      typeof persistedPlayerId === "string" && persistedPlayerId.trim()
        ? persistedPlayerId.trim().slice(0, 64)
        : null;
    let player = cleanPersistedId ? ruotaGetPlayerById(room, cleanPersistedId) : null;
    if (player) {
      if (
        player.connected &&
        player.socketId &&
        player.socketId !== socket.id &&
        isTabooSocketAlive(player.socketId)
      ) {
        const freshId = uuidv4();
        room.pendingPlayerIds[socket.id] = freshId;
        socket.emit("ruotaRoomJoined", { roomID, socketId: socket.id, playerId: freshId });
        socket.emit("ruotaState", serializeRuotaRoom(room));
        return;
      }
      ruotaClearCleanupTimer(room, player.id);
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      room.pendingPlayerIds[socket.id] = player.id;
      socket.emit("ruotaRoomJoined", { roomID, socketId: socket.id, playerId: player.id });
      broadcastRuotaState(room);
      return;
    }
    const assignedId = cleanPersistedId || uuidv4();
    room.pendingPlayerIds[socket.id] = assignedId;
    socket.emit("ruotaRoomJoined", { roomID, socketId: socket.id, playerId: assignedId });
    socket.emit("ruotaState", serializeRuotaRoom(room));
  });

  socket.on("ruotaSetName", (roomID, name, clientPlayerId) => {
    const room = ruotaRooms.get(roomID);
    if (!room || room.phase !== "lobby") return;
    const playerName = String(name || "").trim().slice(0, 20) || "Giocatore";
    let player = ruotaResolvePlayer(room, socket, clientPlayerId);
    if (!player) {
      const pendingId = room.pendingPlayerIds[socket.id];
      const wantedId = (typeof clientPlayerId === "string" && clientPlayerId.trim()) || pendingId || uuidv4();
      const cleanId = String(wantedId).slice(0, 64);
      if (room.players.length >= 4 && !ruotaGetPlayerById(room, cleanId)) {
        socket.emit("ruotaError", "La stanza è piena (max 4 giocatori).");
        return;
      }
      player = { id: cleanId, socketId: socket.id, name: playerName, ready: false, connected: true, disconnectedAt: null, roundPot: 0, totalPot: 0 };
      room.players.push(player);
      room.pendingPlayerIds[socket.id] = player.id;
    } else {
      player.name = playerName;
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      ruotaClearCleanupTimer(room, player.id);
    }
    broadcastRuotaState(room);
  });

  socket.on("ruotaSetReady", (roomID, ready, clientPlayerId) => {
    const room = ruotaRooms.get(roomID);
    if (!room || room.phase !== "lobby") return;
    const player = ruotaResolvePlayer(room, socket, clientPlayerId);
    if (!player) return;
    player.ready = !!ready;
    broadcastRuotaState(room);
    if (checkRuotaCanStart(room)) {
      ruotaStartRound(room, 1, 0);
      broadcastRuotaState(room);
    }
  });

  socket.on("ruotaSpin", (roomID, clientPlayerId) => {
    const room = ruotaRooms.get(roomID);
    if (!room || room.phase !== "playing") return;
    const actor = ruotaResolvePlayer(room, socket, clientPlayerId);
    if (!actor) return;
    const current = room.players[room.currentPlayerIndex % room.players.length];
    if (!current || actor.id !== current.id) {
      socket.emit("ruotaError", "Non è il tuo turno.");
      return;
    }
    if (room.pendingValue !== null) {
      socket.emit("ruotaError", "Hai già girato: chiama una consonante.");
      return;
    }
    const spinIndex = Math.floor(Math.random() * RUOTA_WHEEL_BASE.length);
    const labels = ruotaGetWheelLabels(room.roundNumber);
    const outcome = labels[spinIndex];
    room.spinNonce += 1;
    if (outcome.type === "bancarotta") {
      actor.roundPot = 0;
      actor.totalPot = 0;
      room.lastSpin = { index: spinIndex, type: "bancarotta", label: "BANCAROTTA", nonce: room.spinNonce };
      room.pendingValue = null;
      room.pendingSpinIndex = null;
      broadcastRuotaState(room);
      ruotaAdvanceTurn(room);
      broadcastRuotaState(room);
      return;
    }
    if (outcome.type === "passamano") {
      room.lastSpin = { index: spinIndex, type: "passamano", label: "PASSA", nonce: room.spinNonce };
      room.pendingValue = null;
      room.pendingSpinIndex = null;
      broadcastRuotaState(room);
      ruotaAdvanceTurn(room);
      broadcastRuotaState(room);
      return;
    }
    room.pendingValue = outcome.value;
    room.pendingSpinIndex = spinIndex;
    room.lastSpin = { index: spinIndex, type: "money", value: outcome.value, label: outcome.label, nonce: room.spinNonce, special: !!outcome.special };
    broadcastRuotaState(room);
  });

  socket.on("ruotaCallLetter", (roomID, rawLetter, clientPlayerId) => {
    const room = ruotaRooms.get(roomID);
    if (!room || room.phase !== "playing") return;
    const actor = ruotaResolvePlayer(room, socket, clientPlayerId);
    if (!actor) return;
    const current = room.players[room.currentPlayerIndex % room.players.length];
    if (!current || actor.id !== current.id) {
      socket.emit("ruotaError", "Non è il tuo turno.");
      return;
    }
    const letter = ruotaNormalizeText(rawLetter).charAt(0);
    if (!letter || !/[A-Z]/.test(letter)) {
      socket.emit("ruotaError", "Lettera non valida.");
      return;
    }
    if (room.calledLetters.includes(letter)) {
      socket.emit("ruotaError", "Lettera già chiamata.");
      return;
    }
    const isVowel = RUOTA_VOWELS.includes(letter);
    if (isVowel) {
      if (room.pendingValue !== null) {
        socket.emit("ruotaError", "Dopo aver girato devi chiamare una consonante. Compra la vocale prima di girare.");
        return;
      }
      if ((actor.roundPot || 0) < RUOTA_VOWEL_COST) {
        socket.emit("ruotaError", "Montepremi del round insufficiente per comprare una vocale (500€).");
        return;
      }
      actor.roundPot -= RUOTA_VOWEL_COST;
      room.calledLetters.push(letter);
      const count = ruotaRevealLetter(room, letter);
      if (count === 0) {
        broadcastRuotaState(room);
        ruotaAdvanceTurn(room);
        broadcastRuotaState(room);
      } else {
        if (ruotaCountUnrevealed(room) === 0) {
          ruotaBankRoundPot(room, actor);
          room.pendingValue = null;
          room.pendingSpinIndex = null;
          if (room.roundNumber >= room.totalRounds) {
            room.phase = "ended";
            room.winner = ruotaComputeWinner(room);
          } else {
            room.phase = "roundEnd";
          }
          broadcastRuotaState(room);
        } else {
          broadcastRuotaState(room);
        }
      }
      return;
    }
    // Consonante: richiede spin previo
    if (room.pendingValue === null) {
      socket.emit("ruotaError", "Gira prima la ruota per chiamare una consonante.");
      return;
    }
    room.calledLetters.push(letter);
    const count = ruotaRevealLetter(room, letter);
    const gained = count * room.pendingValue;
    if (count === 0) {
      room.pendingValue = null;
      room.pendingSpinIndex = null;
      broadcastRuotaState(room);
      ruotaAdvanceTurn(room);
      broadcastRuotaState(room);
    } else {
      actor.roundPot = (actor.roundPot || 0) + gained;
      room.pendingValue = null;
      room.pendingSpinIndex = null;
      if (ruotaCountUnrevealed(room) === 0) {
        ruotaBankRoundPot(room, actor);
        if (room.roundNumber >= room.totalRounds) {
          room.phase = "ended";
          room.winner = ruotaComputeWinner(room);
        } else {
          room.phase = "roundEnd";
        }
      }
      broadcastRuotaState(room);
    }
  });

  socket.on("ruotaSolve", (roomID, rawText, clientPlayerId) => {
    const room = ruotaRooms.get(roomID);
    if (!room || room.phase !== "playing") return;
    const actor = ruotaResolvePlayer(room, socket, clientPlayerId);
    if (!actor) return;
    const current = room.players[room.currentPlayerIndex % room.players.length];
    if (!current || actor.id !== current.id) {
      socket.emit("ruotaError", "Non è il tuo turno.");
      return;
    }
    // La soluzione si può dare solo prima di girare la ruota: dopo lo
    // spin bisogna prima chiamare la consonante. Il bottone Risolvi è
    // disabilitato in quel caso, quindi una solve inattesa si ignora
    // silenziosamente senza messaggi di errore.
    if (room.pendingValue !== null) {
      return;
    }
    const attempt = ruotaNormalizeText(rawText);
    if (!attempt) {
      socket.emit("ruotaError", "Inserisci una soluzione.");
      return;
    }
    const target = ruotaNormalizeText(room.phrase.frase);
    if (attempt === target) {
      room.revealed = room.revealed.map(() => true);
      ruotaBankRoundPot(room, actor);
      room.pendingValue = null;
      room.pendingSpinIndex = null;
      if (room.roundNumber >= room.totalRounds) {
        room.phase = "ended";
        room.winner = ruotaComputeWinner(room);
      } else {
        room.phase = "roundEnd";
      }
      broadcastRuotaState(room);
    } else {
      room.pendingValue = null;
      room.pendingSpinIndex = null;
      broadcastRuotaState(room);
      ruotaAdvanceTurn(room);
      broadcastRuotaState(room);
    }
  });

  socket.on("ruotaNextRound", (roomID) => {
    const room = ruotaRooms.get(roomID);
    if (!room || room.phase !== "roundEnd") return;
    if (room.roundNumber >= room.totalRounds) return;
    const nextStarter = (room.starterIndex + 1) % Math.max(1, room.players.length);
    ruotaStartRound(room, room.roundNumber + 1, nextStarter);
    broadcastRuotaState(room);
  });

  socket.on("ruotaReset", (roomID) => {
    const oldRoom = ruotaRooms.get(roomID);
    const players = oldRoom ? oldRoom.players : [];
    Object.values((oldRoom && oldRoom.cleanupTimers) || {}).forEach(clearTimeout);
    initializeRuotaRoom(roomID);
    const room = ruotaRooms.get(roomID);
    room.players = players.map((p) => ({ ...p, ready: false, roundPot: 0, totalPot: 0, connected: p.connected !== false }));
    if (room.currentPlayerIndex >= room.players.length) room.currentPlayerIndex = 0;
    room.starterIndex = 0;
    broadcastRuotaState(room);
  });

  socket.on("disconnect", () => {
    tabooRooms.forEach((room, roomID) => {
      if (room.pendingPlayerIds && room.pendingPlayerIds[socket.id]) {
        delete room.pendingPlayerIds[socket.id];
      }
      const player = getPlayerBySocket(room, socket.id);
      if (player) {
        // Niente pausa automatica e niente rimozione immediata:
        // il gioco continua, il timer resta attivo, lo slot resta riservato.
        player.connected = false;
        player.disconnectedAt = Date.now();
        player.socketId = null;

        // Solo in lobby/ended lo slot si libera dopo il grace period.
        // In playing/paused: nessun purge, si attende il rejoin o il reset.
        if (room.gameState !== "playing" && room.gameState !== "paused") {
          scheduleTabooLobbyCleanup(roomID, player.id);
        }

        broadcastTabooState(room);
      }
    });
    ruotaRooms.forEach((room, roomID) => {
      if (room.pendingPlayerIds && room.pendingPlayerIds[socket.id]) {
        delete room.pendingPlayerIds[socket.id];
      }
      const player = ruotaGetPlayerBySocket(room, socket.id);
      if (player) {
        player.connected = false;
        player.disconnectedAt = Date.now();
        player.socketId = null;
        if (room.phase !== "playing" && room.phase !== "roundEnd") {
          ruotaScheduleLobbyCleanup(roomID, player.id);
        }
        broadcastRuotaState(room);
      }
    });
  });
});

httpServer.listen(PORT);

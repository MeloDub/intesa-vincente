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

const tabooRooms = new Map();

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
  });
});

httpServer.listen(PORT);

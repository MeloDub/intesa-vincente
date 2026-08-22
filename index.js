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
    timer: 60,
    timerInterval: null,
    turnTransitioning: false,
    gameState: "lobby",
    winner: null
  });
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
  room.timer = 60;
  return { currentDescriptorId: room.currentDescriptorId, currentWord: word };
}

function serializeRoom(room) {
  return {
    roomID: room.roomID,
    players: room.players.map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready })),
    teams: {
      rossa: { score: room.teams.rossa.score, players: room.teams.rossa.players.map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready })) },
      blu: { score: room.teams.blu.score, players: room.teams.blu.players.map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready })) }
    },
    currentTurn: room.currentTurn,
    currentDescriptorId: room.currentDescriptorId,
    currentWord: room.currentWord,
    roundNumber: room.roundNumber,
    totalRounds: room.totalRounds,
    timer: room.timer,
    gameState: room.gameState,
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
    room.timer = 60;
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

  startNewTurn(room);
  room.turnTransitioning = false;
  broadcastTabooState(room, "gong");
}

function checkCanStartGame(room) {
  if (room.gameState !== "lobby") return false;
  if (room.players.length !== 4) return false;

  const allReady = room.players.every((p) => p.ready);
  const rossaCount = room.teams.rossa.players.length;
  const bluCount = room.teams.blu.players.length;

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

  socket.on("tabooJoinRoom", (roomID) => {
    socket.join(roomID);
    socket.emit("tabooRoomJoined", { roomID, socketId: socket.id });

    if (!tabooRooms.has(roomID)) {
      initializeTabooRoom(roomID);
    }

    const room = tabooRooms.get(roomID);
    socket.emit("tabooState", serializeRoom(room));
  });

  socket.on("tabooSetName", (roomID, name) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    const playerName = String(name || "").trim().slice(0, 20) || "Giocatore";

    let player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      player = {
        id: socket.id,
        name: playerName,
        team: null,
        ready: false
      };
      room.players.push(player);
    } else {
      player.name = playerName;
    }

    broadcastTabooState(room);
  });

  socket.on("tabooSetTeam", (roomID, team) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;
    if (team !== "rossa" && team !== "blu") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    if (room.teams[team].players.length >= 2 && player.team !== team) {
      socket.emit("tabooError", "La squadra è già piena (max 2 giocatori).");
      return;
    }

    const previousTeam = player.team;
    if (previousTeam && previousTeam !== team) {
      room.teams[previousTeam].players = room.teams[previousTeam].players.filter(
        (p) => p.id !== socket.id
      );
    }

    player.team = team;
    if (!room.teams[team].players.includes(player)) {
      room.teams[team].players.push(player);
    }

    broadcastTabooState(room);
    
    // Invia la squadra assegnata al client per aggiornare myTeam
    socket.emit("tabooSetTeamResponse", team);
  });

  socket.on("tabooSetReady", (roomID, ready) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
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

  socket.on("tabooCorrectAnswer", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;
    if (socket.id !== room.currentDescriptorId) {
      socket.emit("tabooError", "Solo il descrittore può segnare un punto.");
      return;
    }

    room.teams[room.currentTurn].score++;

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    broadcastTabooState(room, "correct");
  });

  socket.on("tabooSkipWord", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;
    if (socket.id !== room.currentDescriptorId) {
      socket.emit("tabooError", "Solo il descrittore può saltare una parola.");
      return;
    }

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    broadcastTabooState(room);
  });

  socket.on("tabooSignalTaboo", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.team || player.team === room.currentTurn) {
      socket.emit("tabooError", "Solo la squadra avversaria può segnalare un taboo.");
      return;
    }

    room.teams[room.currentTurn].score = Math.max(0, room.teams[room.currentTurn].score - 1);

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    broadcastTabooState(room, "wrong");
  });

  socket.on("tabooNextTurn", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;
    if (socket.id !== room.currentDescriptorId) {
      socket.emit("tabooError", "Solo il descrittore può terminare il turno.");
      return;
    }

    stopServerTimer(room);
    handleTurnEnd(roomID);
  });

  socket.on("tabooPause", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    stopServerTimer(room);
    room.gameState = "paused";
    broadcastTabooState(room);
  });

  socket.on("tabooResume", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "paused") return;

    room.gameState = "playing";
    broadcastTabooState(room);
    startServerTimer(roomID, false);
  });

  socket.on("tabooReset", (roomID) => {
    const oldRoom = tabooRooms.get(roomID);
    stopServerTimer(oldRoom);

    const players = oldRoom ? oldRoom.players : [];
    initializeTabooRoom(roomID);

    const room = tabooRooms.get(roomID);
    room.players = players.map((p) => ({ ...p, ready: false }));
    room.players.forEach((p) => {
      if (p.team) {
        room.teams[p.team].players.push(p);
      }
    });

    broadcastTabooState(room);
  });

  socket.on("disconnect", () => {
    tabooRooms.forEach((room, roomID) => {
      const playerIndex = room.players.findIndex((p) => p.id === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        if (player.team) {
          room.teams[player.team].players = room.teams[player.team].players.filter(
            (p) => p.id !== socket.id
          );
        }
        room.players.splice(playerIndex, 1);

        if (room.gameState === "playing") {
          stopServerTimer(room);
          room.gameState = "paused";
        }

        broadcastTabooState(room);
      }
    });
  });
});

httpServer.listen(PORT);

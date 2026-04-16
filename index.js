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

PORT = process.env.PORT || 3000;

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

// Route per la schermata di vittoria
app.use("/taboo/victory/:uuid/:winner", (req, res) => {
  res.render("taboo/victory", { 
    gameID: req.params.uuid,
    winner: decodeURIComponent(req.params.winner)
  });
});

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
    return tabooWords[Math.floor(Math.random() * tabooWords.length)];
  }
  return available[Math.floor(Math.random() * available.length)];
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
    gameState: "lobby"
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
    gameState: room.gameState
  };
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

  const previousTurn = room.currentTurn;
  room.currentTurn = previousTurn === "rossa" ? "blu" : "rossa";

  if (previousTurn === "blu") {
    room.teams.rossa.descriptorIndex = (room.teams.rossa.descriptorIndex + 1) % room.teams.rossa.players.length;
    room.teams.blu.descriptorIndex = (room.teams.blu.descriptorIndex + 1) % room.teams.blu.players.length;
    room.roundNumber++;

    if (room.roundNumber > room.totalRounds) {
      room.gameState = "ended";
      
      const winner = room.teams.rossa.score > room.teams.blu.score 
        ? encodeURIComponent("Squadra Rossa") 
        : room.teams.blu.score > room.teams.rossa.score 
          ? encodeURIComponent("Squadra Blu") 
          : encodeURIComponent("Pareggio");

      // Reindirizza alla schermata di vittoria
      io.to(roomID).emit("tabooGameEnded", {
        ...serializeRoom(room),
        winner: winner,
        rossaScore: room.teams.rossa.score,
        bluScore: room.teams.blu.score
      });
      
      // Reindirizza tutti i giocatori nella stanza alla schermata di vittoria
      io.to(roomID).emit("tabooRedirectVictory", `/taboo/victory/${room.roomID}/${winner}`);
      return;
    }
  }

  const turnData = startNewTurn(room);
  io.to(roomID).emit("tabooTurnChanged", {
    ...serializeRoom(room),
    currentDescriptorId: turnData.currentDescriptorId
  });
  startServerTimer(roomID);
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
    socket.emit("tabooUpdateState", serializeRoom(room));
  });

  socket.on("tabooSetName", (roomID, name) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    let player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      player = {
        id: socket.id,
        name: name,
        team: null,
        ready: false
      };
      room.players.push(player);
    } else {
      player.name = name;
    }

    io.to(roomID).emit("tabooUpdateState", serializeRoom(room));
  });

  socket.on("tabooSetTeam", (roomID, team) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const previousTeam = player.team;
    if (previousTeam) {
      room.teams[previousTeam].players = room.teams[previousTeam].players.filter(
        (p) => p.id !== socket.id
      );
    }

    player.team = team;
    room.teams[team].players.push(player);

    io.to(roomID).emit("tabooUpdateState", serializeRoom(room));
    
    // Invia la squadra assegnata al client per aggiornare myTeam
    socket.emit("tabooSetTeamResponse", team);
  });

  socket.on("tabooSetReady", (roomID, ready) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    player.ready = ready;

    io.to(roomID).emit("tabooUpdateState", serializeRoom(room));

    if (checkCanStartGame(room)) {
      room.gameState = "playing";
      startNewTurn(room);
      io.to(roomID).emit("tabooGameStarted", serializeRoom(room));
      startServerTimer(roomID);
    }
  });

  socket.on("tabooCorrectAnswer", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;

    room.teams[room.currentTurn].score++;

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    io.to(roomID).emit("tabooWordSolved", {
      word: word,
      rossaScore: room.teams.rossa.score,
      bluScore: room.teams.blu.score,
      timer: room.timer
    });
  });

  socket.on("tabooSkipWord", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    io.to(roomID).emit("tabooWordSkipped", {
      word: word,
      timer: room.timer
    });
  });

  socket.on("tabooSignalTaboo", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;

    room.teams[room.currentTurn].score = Math.max(0, room.teams[room.currentTurn].score - 1);

    const word = getRandomTabooWord(room.usedWords);
    room.currentWord = word;

    io.to(roomID).emit("tabooTabooSignaled", {
      word: word,
      rossaScore: room.teams.rossa.score,
      bluScore: room.teams.blu.score
    });
  });

  socket.on("tabooNextTurn", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room || room.gameState !== "playing") return;

    stopServerTimer(room);
    handleTurnEnd(roomID);
  });

  socket.on("tabooPause", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    stopServerTimer(room);
    room.gameState = "paused";
    io.to(roomID).emit("tabooGamePaused", serializeRoom(room));
  });

  socket.on("tabooResume", (roomID) => {
    const room = tabooRooms.get(roomID);
    if (!room) return;

    room.gameState = "playing";
    io.to(roomID).emit("tabooGameResumed", serializeRoom(room));
    startServerTimer(roomID, false);
  });

  socket.on("tabooReset", (roomID) => {
    stopServerTimer(tabooRooms.get(roomID));
    initializeTabooRoom(roomID);
    io.to(roomID).emit("tabooUpdateState", serializeRoom(tabooRooms.get(roomID)));
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

        io.to(roomID).emit("tabooUpdateState", serializeRoom(room));
      }
    });
  });
});

httpServer.listen(PORT);

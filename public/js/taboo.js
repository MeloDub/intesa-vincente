const socket = io();

let gameState = null;
let mySocketId = null;
let myTeam = null;

const elements = {};

function initElements() {
  elements.teamRossaScore = document.getElementById("teamRossaScore");
  elements.teamBluScore = document.getElementById("teamBluScore");
  elements.time = document.getElementById("time");
  elements.currentTurn = document.getElementById("currentTurn");
  elements.word = document.getElementById("word");
  elements.wordText = document.getElementById("wordText");
  elements.tabooWords = document.querySelectorAll(".taboo-word");
  elements.tabooList = document.querySelector(".taboo-list");
  elements.roundInfo = document.getElementById("roundInfo");
  elements.playerName = document.getElementById("playerName");
  elements.teamA = document.getElementById("teamA");
  elements.teamB = document.getElementById("teamB");
  elements.readyBtn = document.getElementById("readyBtn");
  elements.playersList = document.getElementById("playersList");
  elements.roleIndicator = document.getElementById("roleIndicator");
  elements.wordArea = document.getElementById("wordArea");
  elements.controlsArea = document.getElementById("controlsArea");
  elements.lobbyArea = document.getElementById("lobbyArea");
  elements.gameArea = document.getElementById("gameArea");
  elements.victoryArea = document.getElementById("victoryArea");
  elements.victoryRossaScore = document.getElementById("victoryRossaScore");
  elements.victoryBluScore = document.getElementById("victoryBluScore");
  elements.winnerText = document.getElementById("winnerText");
  elements.restartBtn = document.getElementById("restartBtn");
}

function updateUI() {
  if (!gameState) return;

  if (elements.teamRossaScore) elements.teamRossaScore.textContent = gameState.teams.rossa.score;
  if (elements.teamBluScore) elements.teamBluScore.textContent = gameState.teams.blu.score;
  if (elements.time) elements.time.textContent = gameState.timer || 60;
  if (elements.roundInfo) elements.roundInfo.textContent = `Round ${gameState.roundNumber} di ${gameState.totalRounds}`;

  updatePlayersList();
  updateGameView();
}

function updatePlayersList() {
  if (!gameState || !elements.playersList) return;

  elements.playersList.innerHTML = "";

  const squadraRossa = gameState.teams.rossa.players;
  const squadrablu = gameState.teams.blu.players;

  if (squadraRossa && squadraRossa.length > 0) {
    const teamARossaContainer = document.createElement("div");
    teamARossaContainer.className = "flex items-center gap-2 flex-wrap";
    teamARossaContainer.innerHTML = `<span class="font-bold text-red-500">Squadra Rossa:</span>`;
    squadraRossa.forEach((p) => {
      const player = gameState.players.find((pl) => pl.id === p.id);
      const readyMark = player?.ready ? " ✓" : "";
      teamARossaContainer.innerHTML += `<span>${player?.name || "Giocatore"}${readyMark}</span>`;
    });
    elements.playersList.appendChild(teamARossaContainer);
  }

  if (squadrablu && squadrablu.length > 0) {
    const teamABluContainer = document.createElement("div");
    teamABluContainer.className = "flex items-center gap-2 flex-wrap";
    teamABluContainer.innerHTML = `<span class="font-bold text-blue-500">Squadra Blu:</span>`;
    squadrablu.forEach((p) => {
      const player = gameState.players.find((pl) => pl.id === p.id);
      const readyMark = player?.ready ? " ✓" : "";
      teamABluContainer.innerHTML += `<span>${player?.name || "Giocatore"}${readyMark}</span>`;
    });
    elements.playersList.appendChild(teamABluContainer);
  }

  const readyCount = gameState.players.filter((p) => p.ready).length;
  if (readyCount < 4) {
    elements.playersList.innerHTML += `<p class="text-sm text-gray-500 mt-2">In attesa di altri giocatori... (${readyCount}/4 pronti)</p>`;
  }
}

function updateGameView() {
  const isMyTeamPlaying = myTeam === gameState.currentTurn;
  const isDescriptor = gameState.currentDescriptorId === mySocketId;
  const isGuesser = isMyTeamPlaying && !isDescriptor;

  if (gameState.gameState === "lobby") {
    if (elements.lobbyArea) elements.lobbyArea.classList.remove("hidden");
    if (elements.gameArea) elements.gameArea.classList.add("hidden");
    return;
  }

  if (gameState.gameState === "ended") {
    if (elements.gameArea) elements.gameArea.classList.add("hidden");
    if (elements.victoryArea) elements.victoryArea.classList.remove("hidden");
    elements.victoryRossaScore.textContent = gameState.rossaScore;
    elements.victoryBluScore.textContent = gameState.bluScore;
    return;
  }

  if (elements.lobbyArea) elements.lobbyArea.classList.add("hidden");
  if (elements.gameArea) elements.gameArea.classList.remove("hidden");

  if (!gameState.currentWord) return;

  if (elements.currentTurn) {
    elements.currentTurn.textContent = gameState.currentTurn === "rossa"
        ? "Turno Squadra Rossa"
        : "Turno Squadra Blu";
  }

  if (elements.wordArea) {
    if (!isMyTeamPlaying) {
      elements.wordArea.classList.add("border-yellow-400", "border-4");
    } else {
      elements.wordArea.classList.remove("border-yellow-400", "border-4");
    }
  }

  if (isGuesser) {
    if (elements.word) elements.word.textContent = "???";
    if (elements.tabooList) elements.tabooList.classList.add("hidden");
  } else {
    if (elements.word && elements.wordText) {
      elements.wordText.textContent = gameState.currentWord.word;
      elements.word.textContent = gameState.currentWord.word;
    }
    if (elements.tabooList) {
      elements.tabooList.classList.remove("hidden");
      if (elements.tabooWords) {
        gameState.currentWord.taboo.forEach((taboo, i) => {
          if (elements.tabooWords[i]) {
            elements.tabooWords[i].textContent = taboo;
          }
        });
      }
    }
  }

  updateRoleControls();
}

function updateRoleControls() {
  const isMyTeamPlaying = myTeam === gameState.currentTurn;
  const isDescriptor = gameState.currentDescriptorId === mySocketId;
  const isGuesser = isMyTeamPlaying && !isDescriptor;

  if (elements.roleIndicator) {
    if (isMyTeamPlaying) {
      if (isDescriptor) {
        elements.roleIndicator.textContent = "Sei il DESCRITTORE";
        elements.roleIndicator.className = "text-purple-500 font-bold text-xl";
      } else {
        elements.roleIndicator.textContent = "Sei l'INDOVINATORE - Ascolta!";
        elements.roleIndicator.className = "text-green-500 font-bold text-xl";
      }
    } else {
      elements.roleIndicator.textContent = "Squadra avversaria - Segnala i Taboo!";
      elements.roleIndicator.className = "text-yellow-600 font-bold text-xl";
    }
  }

  if (elements.controlsArea) {
    elements.controlsArea.innerHTML = "";

    if (isMyTeamPlaying && isDescriptor) {
      elements.controlsArea.innerHTML = `
        <div class="flex gap-4 justify-center text-3xl">
          <button onclick="handleCorrect()" class="button success pill-left flex-1 text-2xl py-4">
            <ion-icon name="checkmark-outline"></ion-icon> Corretto
          </button>
          <button onclick="handleSkip()" class="button pill-right text-2xl py-4">
            <ion-icon name="arrow-forward-outline"></ion-icon> Salta
          </button>
        </div>
      `;
    } else if (!isMyTeamPlaying) {
      elements.controlsArea.innerHTML = `
        <button onclick="handleTaboo()" class="button warning text-4xl py-6 px-12">
          <ion-icon name="hand-left-outline"></ion-icon> TABOO!
        </button>
      `;
    } else if (isGuesser) {
      elements.controlsArea.innerHTML = `
        <p class="text-xl text-green-600 font-bold">Il tuo compagno sta descrivendo... ascolta e indovina!</p>
      `;
    } else {
      elements.controlsArea.innerHTML = `
        <p class="text-xl text-gray-600">Aspetta il tuo turno...</p>
      `;
    }

    const pauseIcon = gameState.gameState === "paused" ? "play-outline" : "pause-outline";
    const pauseText = gameState.gameState === "paused" ? "Riprendi" : "Pausa";
    
    elements.controlsArea.innerHTML += `
      <div class="flex gap-4 justify-center mt-6">
        <button onclick="handlePause()" class="button pill text-xl">
          <ion-icon name="${pauseIcon}"></ion-icon> ${pauseText}
        </button>
        <button onclick="handleNextTurn()" class="button pill text-xl">
          <ion-icon name="swap-horizontal-outline"></ion-icon> Fine Turno
        </button>
      </div>
    `;
  }
}

function updatePauseButton() {
  if (gameState.gameState === "playing") {
    const pauseBtn = document.getElementById("pauseBtn");
    if (pauseBtn) {
      pauseBtn.innerHTML = '<ion-icon name="pause-outline"></ion-icon> Pausa';
    }
  } else if (gameState.gameState === "paused") {
    const pauseBtn = document.getElementById("pauseBtn");
    if (pauseBtn) {
      pauseBtn.innerHTML = '<ion-icon name="play-outline"></ion-icon> Riprendi';
    }
  }
}

function playSound(sound) {
  const audio = document.getElementById(sound);
  if (audio) {
    audio.currentTime = 0;
    audio.play();
  }
}

function handleCorrect() {
  socket.emit("tabooCorrectAnswer", GAME_ID);
}

function handleSkip() {
  socket.emit("tabooSkipWord", GAME_ID);
}

function handleTaboo() {
  socket.emit("tabooSignalTaboo", GAME_ID);
  playSound("wrong");
}

function handlePause() {
  if (gameState.gameState === "playing") {
    socket.emit("tabooPause", GAME_ID);
  } else if (gameState.gameState === "paused") {
    socket.emit("tabooResume", GAME_ID);
  }
}

function handleNextTurn() {
  socket.emit("tabooNextTurn", GAME_ID);
}

function setupLobby() {
  if (!elements.playerName) return;

  elements.playerName.addEventListener("change", () => {
    const name = elements.playerName.value.trim() || "Giocatore";
    socket.emit("tabooSetName", GAME_ID, name);
    elements.teamA.disabled = false;
    elements.teamB.disabled = false;
  });

  elements.teamA.addEventListener("click", () => {
    if (elements.teamA.disabled) return;
    socket.emit("tabooSetTeam", GAME_ID, "rossa");
    myTeam = "rossa";
    elements.teamA.classList.add("bg-blue-500");
    elements.teamB.classList.remove("bg-red-500");
  });

  elements.teamB.addEventListener("click", () => {
    if (elements.teamB.disabled) return;
    socket.emit("tabooSetTeam", GAME_ID, "blu");
    myTeam = "blu";
    elements.teamB.classList.add("bg-red-500");
    elements.teamA.classList.remove("bg-blue-500");
  });
  
  socket.emit("tabooJoinRoom", GAME_ID);
}

function updateReadyButton() {
  if (!elements.readyBtn) return;

  if (myTeam && gameState) {
    const teamPlayers = myTeam === "rossa" ? gameState.teams.rossa.players : gameState.teams.blu.players;
    const teamPlayerCount = teamPlayers ? teamPlayers.length : 0;

    if (teamPlayerCount < 2) {
      elements.readyBtn.disabled = true;
      elements.readyBtn.innerHTML = 'Aspetta 2 giocatori in squadra';
    } else {
      elements.readyBtn.disabled = false;
      const player = gameState.players.find((p) => p.id === mySocketId);
      if (player?.ready) {
        elements.readyBtn.dataset.ready = "true";
        elements.readyBtn.innerHTML = '<ion-icon name="close-outline"></ion-icon> Non Pronto';
        elements.readyBtn.classList.remove("bg-red-500");
        elements.readyBtn.classList.add("bg-green-500");
      } else {
        elements.readyBtn.dataset.ready = "false";
        elements.readyBtn.innerHTML = '<ion-icon name="checkmark-outline"></ion-icon> Pronto';
        elements.readyBtn.classList.remove("bg-green-500");
        elements.readyBtn.classList.add("bg-red-500");
      }
    }
  } else {
    elements.readyBtn.disabled = true;
  }
}

function setupReadyButton() {
  const readyBtn = document.getElementById("readyBtn");
  if (!readyBtn) return;

  readyBtn.addEventListener("click", () => {
    const isReady = readyBtn.dataset.ready === "true";
    socket.emit("tabooSetReady", GAME_ID, !isReady);
  });
}

socket.on("connect", () => {
  mySocketId = socket.id;
  // setupLobby();
});

socket.on("tabooRoomJoined", (data) => {
  mySocketId = data.socketId;
});

// Handler per la conferma dell'assegnazione della squadra
socket.on("tabooSetTeamResponse", (team) => {
  myTeam = team;
  updateReadyButton();
});

socket.on("tabooUpdateState", (state) => {
  gameState = state;

  const me = state.players.find((p) => p.id === mySocketId);
  if (me) {
    myTeam = me.team;
  }

  updateUI();
  updateReadyButton();
});

socket.on("tabooGameStarted", (state) => {
  gameState = state;
  updateUI();
  playSound("gong");
});

socket.on("tabooWordSolved", (data) => {
  gameState.currentWord = data.word;
  gameState.teams.rossa.score = data.rossaScore;
  gameState.teams.blu.score = data.bluScore;
  gameState.timer = data.timer;
  updateUI();
  playSound("correct");
});

socket.on("tabooTabooSignaled", (data) => {
  gameState.teams.rossa.score = data.rossaScore;
  gameState.teams.blu.score = data.bluScore;
  gameState.currentWord = data.word;
  updateUI();
  playSound("wrong");
});

socket.on("tabooTurnChanged", (state) => {
  gameState = state;
  updateUI();
  playSound("gong");
});

socket.on("tabooTimerTick", (time) => {
  if (elements.time) {
    elements.time.textContent = time;
  }
});

socket.on("tabooGamePaused", (state) => {
  gameState = state;
  updateUI();
  updatePauseButton();
});

socket.on("tabooGameResumed", (state) => {
  gameState = state;
  updateUI();
  updatePauseButton();
});

socket.on("tabooGameEnded", (state) => {
  gameState = state;
  updateUI();
  playSound("gong");
});

socket.on("tabooError", (message) => {
  alert(message);
});

document.addEventListener("DOMContentLoaded", async () => {
  initElements();
  setupLobby();
  setupReadyButton();
  socket.emit("tabooJoinRoom", GAME_ID);
});

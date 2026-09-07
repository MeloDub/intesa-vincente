const socket = io();

let gameState = null;
let mySocketId = null;
let myPlayerId = null;
let myTeam = null;

function getPlayerStorageKey() {
  try {
    return "taboo:" + GAME_ID + ":playerId";
  } catch (e) {
    return null;
  }
}

function getStoredPlayerId() {
  try {
    const key = getPlayerStorageKey();
    return key ? localStorage.getItem(key) : null;
  } catch (e) {
    return null;
  }
}

function storePlayerId(id) {
  if (!id) return;
  myPlayerId = id;
  try {
    const key = getPlayerStorageKey();
    if (key) localStorage.setItem(key, id);
  } catch (e) {
    // storage non disponibile (es. privacy mode): si continua in memoria
  }
}

function joinTabooRoom() {
  const storedId = myPlayerId || getStoredPlayerId();
  socket.emit("tabooJoinRoom", GAME_ID, storedId || null);
}

function ensureConnectionBanner() {
  let banner = document.getElementById("connectionBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "connectionBanner";
    banner.className =
      "hidden fixed top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm font-bold shadow";
    banner.textContent = "Connessione persa, riconnessione...";
    document.body.appendChild(banner);
  }
  return banner;
}

function setConnectionBanner(visible, text) {
  const banner = ensureConnectionBanner();
  if (text) banner.textContent = text;
  banner.classList.toggle("hidden", !visible);
  banner.classList.toggle("bg-yellow-400", visible);
  banner.classList.toggle("text-black", visible);
}

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
  if (elements.time) elements.time.textContent = gameState.timer ?? 120;
  if (elements.roundInfo) elements.roundInfo.textContent = `Round ${gameState.roundNumber} di ${gameState.totalRounds}`;

  updatePlayersList();
  updateGameView();
}

function appendTeamPlayers(container, teamPlayers, labelClass, labelText) {
  const label = document.createElement("span");
  label.className = "font-bold " + labelClass;
  label.textContent = labelText;
  container.appendChild(label);

  teamPlayers.forEach((p) => {
    const player = gameState.players.find((pl) => pl.id === p.id) || p;
    const span = document.createElement("span");
    const offline = player && player.connected === false;
    span.textContent =
      (player?.name || "Giocatore") +
      (player?.ready ? " ✓" : "") +
      (offline ? " (offline)" : "");
    if (offline) span.className = "opacity-50 italic";
    container.appendChild(span);
  });
}

function updatePlayersList() {
  if (!gameState || !elements.playersList) return;

  elements.playersList.innerHTML = "";

  const squadraRossa = gameState.teams.rossa.players;
  const squadrablu = gameState.teams.blu.players;

  if (squadraRossa && squadraRossa.length > 0) {
    const teamARossaContainer = document.createElement("div");
    teamARossaContainer.className = "flex items-center gap-2 flex-wrap";
    appendTeamPlayers(teamARossaContainer, squadraRossa, "text-red-500", "Squadra Rossa:");
    elements.playersList.appendChild(teamARossaContainer);
  }

  if (squadrablu && squadrablu.length > 0) {
    const teamABluContainer = document.createElement("div");
    teamABluContainer.className = "flex items-center gap-2 flex-wrap";
    appendTeamPlayers(teamABluContainer, squadrablu, "text-blue-500", "Squadra Blu:");
    elements.playersList.appendChild(teamABluContainer);
  }

  const readyCount = gameState.players.filter((p) => p.ready).length;
  if (readyCount < 4) {
    const waiting = document.createElement("p");
    waiting.className = "text-sm text-gray-500 mt-2";
    waiting.textContent = `In attesa di altri giocatori... (${readyCount}/4 pronti)`;
    elements.playersList.appendChild(waiting);
  }
}

function updateGameView() {
  const myId = myPlayerId || mySocketId;
  const isMyTeamPlaying = myTeam === gameState.currentTurn;
  const isDescriptor = gameState.currentDescriptorId === myId;
  const isGuesser = isMyTeamPlaying && !isDescriptor;

  if (gameState.gameState === "lobby") {
    if (elements.lobbyArea) elements.lobbyArea.classList.remove("hidden");
    if (elements.gameArea) elements.gameArea.classList.add("hidden");
    if (elements.victoryArea) elements.victoryArea.classList.add("hidden");
    return;
  }

  if (gameState.gameState === "ended") {
    if (elements.lobbyArea) elements.lobbyArea.classList.add("hidden");
    if (elements.gameArea) elements.gameArea.classList.add("hidden");
    if (elements.victoryArea) elements.victoryArea.classList.remove("hidden");
    elements.victoryRossaScore.textContent = gameState.rossaScore;
    elements.victoryBluScore.textContent = gameState.bluScore;
    if (elements.winnerText) {
      elements.winnerText.textContent = gameState.winner || "Partita completata!";
    }
    return;
  }

  if (elements.lobbyArea) elements.lobbyArea.classList.add("hidden");
  if (elements.victoryArea) elements.victoryArea.classList.add("hidden");
  if (elements.gameArea) elements.gameArea.classList.remove("hidden");

  if (!gameState.currentWord) {
    updateRoleControls();
    return;
  }

  // Tra un turno e l'altro (o in pausa manuale) la parola resta nascosta
  // a tutti finché il descrittore preme "Riprendi".
  if (gameState.gameState === "paused") {
    if (elements.currentTurn) {
      elements.currentTurn.textContent =
        (gameState.currentTurn === "rossa" ? "Turno Squadra Rossa" : "Turno Squadra Blu") +
        " — In pausa";
    }
    if (elements.word) elements.word.textContent = "⏸ PAUSA";
    if (elements.wordText) elements.wordText.textContent = "⏸ PAUSA";
    if (elements.tabooList) elements.tabooList.classList.add("hidden");
    if (elements.wordArea) {
      elements.wordArea.classList.remove("border-yellow-400", "border-4");
    }
    updateRoleControls();
    return;
  }

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
  const myId = myPlayerId || mySocketId;
  const isMyTeamPlaying = myTeam === gameState.currentTurn;
  const isDescriptor = gameState.currentDescriptorId === myId;
  const isGuesser = isMyTeamPlaying && !isDescriptor;
  const isPaused = gameState.gameState === "paused";
  const isTurnChange = isPaused && gameState.pauseReason === "turnChange";

  if (elements.roleIndicator) {
    if (isPaused) {
      if (isDescriptor) {
        elements.roleIndicator.textContent = isTurnChange
          ? "Tocca a te! Premi Riprendi quando la squadra è pronta"
          : "Gioco in pausa — Premi Riprendi per continuare";
        elements.roleIndicator.className = "text-purple-500 font-bold text-xl";
      } else if (isMyTeamPlaying) {
        elements.roleIndicator.textContent = "In attesa che il descrittore avvii il turno...";
        elements.roleIndicator.className = "text-gray-600 font-bold text-xl";
      } else {
        elements.roleIndicator.textContent = "Turno avversario in preparazione...";
        elements.roleIndicator.className = "text-yellow-600 font-bold text-xl";
      }
    } else if (isMyTeamPlaying) {
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

    if (isPaused) {
      // Parola nascosta: niente Corretto/Salta/TABOO finché non si riprende.
      if (isDescriptor) {
        const label = isTurnChange ? "Avvia turno" : "Riprendi";
        elements.controlsArea.innerHTML = `
          <button onclick="handlePause()" class="button success text-2xl py-4 px-12">
            <ion-icon name="play-outline"></ion-icon> ${label}
          </button>
        `;
      } else {
        elements.controlsArea.innerHTML = `
          <p class="text-xl text-gray-600">Aspetta che il descrittore prema Riprendi...</p>
        `;
      }
      return;
    }

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

    let extraControls = `
      <div class="flex gap-4 justify-center mt-6">
        <button onclick="handlePause()" class="button pill text-xl">
          <ion-icon name="pause-outline"></ion-icon> Pausa
        </button>`;
    if (isDescriptor) {
      extraControls += `
        <button onclick="handleNextTurn()" class="button pill text-xl">
          <ion-icon name="swap-horizontal-outline"></ion-icon> Fine Turno
        </button>`;
    }
    extraControls += `
      </div>
    `;
    elements.controlsArea.innerHTML += extraControls;
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
  socket.emit("tabooCorrectAnswer", GAME_ID, myPlayerId || null);
}

function handleSkip() {
  socket.emit("tabooSkipWord", GAME_ID, myPlayerId || null);
}

function handleTaboo() {
  socket.emit("tabooSignalTaboo", GAME_ID, myPlayerId || null);
}

function handlePause() {
  if (gameState.gameState === "playing") {
    socket.emit("tabooPause", GAME_ID);
  } else if (gameState.gameState === "paused") {
    socket.emit("tabooResume", GAME_ID, myPlayerId || getStoredPlayerId());
  }
}

function handleNextTurn() {
  socket.emit("tabooNextTurn", GAME_ID, myPlayerId || null);
}

function setupLobby() {
  if (!elements.playerName) return;

  // Ripristina nome già scelto in questo browser per agevolare il rejoin manuale
  try {
    const savedName = localStorage.getItem("taboo:" + GAME_ID + ":name");
    if (savedName && !elements.playerName.value) {
      elements.playerName.value = savedName;
    }
    if (elements.playerName.value.trim()) {
      elements.teamA.disabled = false;
      elements.teamB.disabled = false;
    }
  } catch (e) {}

  elements.playerName.addEventListener("input", () => {
    const name = elements.playerName.value.trim();
    if (name) {
      try {
        localStorage.setItem("taboo:" + GAME_ID + ":name", name);
      } catch (e) {}
      socket.emit("tabooSetName", GAME_ID, name, myPlayerId || getStoredPlayerId());
      elements.teamA.disabled = false;
      elements.teamB.disabled = false;
    } else {
      elements.teamA.disabled = true;
      elements.teamB.disabled = true;
    }
  });

  elements.teamA.addEventListener("click", () => {
    if (elements.teamA.disabled) return;
    socket.emit("tabooSetTeam", GAME_ID, "rossa", myPlayerId || getStoredPlayerId());
    myTeam = "rossa";
  });

  elements.teamB.addEventListener("click", () => {
    if (elements.teamB.disabled) return;
    socket.emit("tabooSetTeam", GAME_ID, "blu", myPlayerId || getStoredPlayerId());
    myTeam = "blu";
  });
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
      const myId = myPlayerId || mySocketId;
      const player = gameState.players.find((p) => p.id === myId);
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
    socket.emit("tabooSetReady", GAME_ID, !isReady, myPlayerId || getStoredPlayerId());
  });
}

function setupRestartButton() {
  if (!elements.restartBtn) return;

  elements.restartBtn.addEventListener("click", () => {
    socket.emit("tabooReset", GAME_ID);
  });
}

socket.on("connect", () => {
  mySocketId = socket.id;
  setConnectionBanner(false);
  // Rejoin automatico: rientra nella room Socket.io e ricollega il playerId persistente.
  // Copre sia il primo connect che ogni reconnect (rete mobile instabile).
  joinTabooRoom();
});

socket.on("disconnect", () => {
  setConnectionBanner(true, "Connessione persa, riconnessione...");
});

socket.io.on("reconnect_attempt", () => {
  setConnectionBanner(true, "Connessione persa, riconnessione...");
});

socket.on("tabooRoomJoined", (data) => {
  mySocketId = data.socketId || socket.id;
  if (data.playerId) {
    storePlayerId(data.playerId);
  }
});

// Handler per la conferma dell'assegnazione della squadra
socket.on("tabooSetTeamResponse", (team) => {
  myTeam = team;
  try {
    localStorage.setItem("taboo:" + GAME_ID + ":team", team);
  } catch (e) {}
  updateReadyButton();
});

socket.on("tabooState", (state) => {
  gameState = state;
  setConnectionBanner(false);

  const myId = myPlayerId || getStoredPlayerId() || mySocketId;
  const me = state.players.find((p) => p.id === myId);
  if (me) {
    if (!myPlayerId) myPlayerId = me.id;
    myTeam = me.team;
    try {
      if (me.team) localStorage.setItem("taboo:" + GAME_ID + ":team", me.team);
    } catch (e) {}
    // Se il nome salvato localmente è vuoto ma il server ne ha uno, precompila l'input
    if (elements.playerName && !elements.playerName.value && me.name) {
      elements.playerName.value = me.name;
    }
  } else {
    if (myId && mySocketId && myId !== mySocketId) {
      // Fallback per compatibilità con stati vecchi basati su socket.id
      const legacyMe = state.players.find((p) => p.id === mySocketId);
      if (legacyMe) myTeam = legacyMe.team;
    }
    // Server riavviato o slot scaduto in lobby: ri-registra automaticamente
    // nome/team salvati con lo stesso playerId persistente.
    try {
      const savedName = localStorage.getItem("taboo:" + GAME_ID + ":name");
      const savedTeam = localStorage.getItem("taboo:" + GAME_ID + ":team");
      if (savedName && state.gameState === "lobby" && state.players.length < 4) {
        socket.emit("tabooSetName", GAME_ID, savedName, myId);
        if (savedTeam === "rossa" || savedTeam === "blu") {
          socket.emit("tabooSetTeam", GAME_ID, savedTeam, myId);
        }
      }
    } catch (e) {}
  }

  updateUI();
  updateReadyButton();
  if (state.sound) playSound(state.sound);
});

socket.on("tabooTimerTick", (time) => {
  if (elements.time) {
    elements.time.textContent = time;
  }
  if (gameState) gameState.timer = time;
});

socket.on("tabooError", (message) => {
  alert(message);
});

document.addEventListener("DOMContentLoaded", async () => {
  initElements();
  myPlayerId = getStoredPlayerId();
  setupLobby();
  setupReadyButton();
  setupRestartButton();
  ensureConnectionBanner();
  joinTabooRoom();
});

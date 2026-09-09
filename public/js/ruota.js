const socket = io();

let gameState = null;
let mySocketId = null;
let myPlayerId = null;
let currentRotation = 0;
let lastSeenNonce = -1;
let spinAnimTimeout = null;

const VOWELS = ["A", "E", "I", "O", "U"];
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const BOARD_ROW_CAPACITIES = [12, 14, 14, 12];

function storageKey(suffix) {
  try {
    return "ruota:" + GAME_ID + ":" + suffix;
  } catch (e) {
    return null;
  }
}

function getStored(key) {
  try {
    const k = storageKey(key);
    return k ? localStorage.getItem(k) : null;
  } catch (e) {
    return null;
  }
}

function setStored(key, val) {
  try {
    const k = storageKey(key);
    if (k) localStorage.setItem(k, val);
  } catch (e) {}
}

function joinRoom() {
  const storedId = myPlayerId || getStored("playerId");
  socket.emit("ruotaJoinRoom", GAME_ID, storedId || null);
}

function ensureBanner() {
  let banner = document.getElementById("connectionBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "connectionBanner";
    banner.className = "hidden fixed top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm font-bold shadow";
    banner.textContent = "Connessione persa, riconnessione...";
    document.body.appendChild(banner);
  }
  return banner;
}

function setBanner(visible, text) {
  const banner = ensureBanner();
  if (text) banner.textContent = text;
  banner.classList.toggle("hidden", !visible);
  banner.classList.toggle("bg-yellow-400", visible);
  banner.classList.toggle("text-black", visible);
}

const el = {};

function initElements() {
  ["playerName", "readyBtn", "playersList", "lobbyArea", "gameArea", "roundEndArea", "victoryArea",
   "playersScore", "roundInfo", "turnInfo", "phraseTitle", "board", "wheel", "wheelCenter",
   "spinResult", "pendingValueInfo", "spinBtn", "solveBtn", "keyboard",
   "solveModal", "solveInput", "solveConfirm", "solveCancel",
   "roundEndText", "roundEndScores", "nextRoundBtn",
   "victoryScores", "winnerText", "restartBtn"].forEach((id) => {
    el[id] = document.getElementById(id);
  });
}

function isMyTurn() {
  if (!gameState) return false;
  const myId = myPlayerId || mySocketId;
  return gameState.currentPlayerId && myId && gameState.currentPlayerId === myId;
}

function myPlayer() {
  if (!gameState) return null;
  const myId = myPlayerId || mySocketId;
  return gameState.players.find((p) => p.id === myId) || null;
}

// ---------- Render ----------

function render() {
  if (!gameState) return;
  renderLobby();
  renderScores();
  if (gameState.phase === "lobby") {
    showOnly("lobby");
  } else if (gameState.phase === "playing") {
    showOnly("game");
  } else if (gameState.phase === "roundEnd") {
    showOnly("game", "roundEnd");
  } else if (gameState.phase === "ended") {
    showOnly("victory");
  }
  renderBoard();
  renderWheel();
  renderControls();
  renderRoundEnd();
  renderVictory();
  updateReadyButton();
}

function showOnly(main, extra) {
  const show = (node, v) => { if (node) node.classList.toggle("hidden", !v); };
  show(el.lobbyArea, main === "lobby");
  show(el.gameArea, main === "game");
  show(el.roundEndArea, extra === "roundEnd");
  show(el.victoryArea, main === "victory");
}

function renderLobby() {
  if (!el.playersList || !gameState) return;
  el.playersList.innerHTML = "";
  gameState.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "flex items-center gap-2 flex-wrap";
    const dot = document.createElement("span");
    dot.textContent = "●";
    dot.className = p.connected === false ? "text-gray-400" : "text-green-500";
    const name = document.createElement("span");
    name.className = "font-bold" + (p.connected === false ? " opacity-50 italic" : "");
    name.textContent = (p.name || "Giocatore") + (p.ready ? " ✓" : "") + (p.connected === false ? " (offline)" : "");
    row.appendChild(dot);
    row.appendChild(name);
    el.playersList.appendChild(row);
  });
  const readyCount = gameState.players.filter((p) => p.ready).length;
  const info = document.createElement("p");
  info.className = "text-sm text-gray-500 mt-2";
  info.textContent = "Giocatori pronti: " + readyCount + "/" + gameState.players.length + " (min 2, max 4)";
  el.playersList.appendChild(info);
}

function renderScores() {
  if (el.roundInfo && gameState) {
    el.roundInfo.textContent = "Round " + gameState.roundNumber + " di " + gameState.totalRounds;
  }
  if (!el.playersScore || !gameState) return;
  el.playersScore.innerHTML = "";
  gameState.players.forEach((p) => {
    const card = document.createElement("div");
    const active = p.id === gameState.currentPlayerId && gameState.phase === "playing";
    card.className = "bg-white rounded-lg p-2 border-2 text-sm" + (active ? " border-green-500 shadow-lg" : " border-gray-300");
    const myId = myPlayerId || mySocketId;
    const you = p.id === myId ? " (tu)" : "";
    card.innerHTML =
      '<div class="font-bold truncate">' + escapeHtml(p.name) + escapeHtml(you) + (p.connected === false ? " <span class='opacity-50'>(off)</span>" : "") + "</div>" +
      '<div>Round: <strong>' + (p.roundPot || 0) + "€</strong></div>" +
      '<div>Tot: <strong>' + (p.totalPot || 0) + "€</strong></div>";
    el.playersScore.appendChild(card);
  });
  if (el.turnInfo) {
    if (gameState.phase !== "playing") {
      el.turnInfo.textContent = "";
    } else {
      const cur = gameState.players.find((p) => p.id === gameState.currentPlayerId);
      el.turnInfo.textContent = cur ? ("Turno di " + cur.name + (isMyTurn() ? " (tocca a te!)" : "")) : "";
      el.turnInfo.className = "text-xl font-bold mt-2 " + (isMyTurn() ? "text-green-600" : "text-gray-700");
    }
  }
  if (el.phraseTitle) el.phraseTitle.textContent = gameState.titolo || "";
}

function isLetterChar(ch) {
  return /[A-ZÀ-Þ]/i.test(ch || "");
}

function renderBoard() {
  if (!el.board || !gameState || !gameState.frase) return;
  el.board.innerHTML = "";
  const frase = gameState.frase;
  const revealed = gameState.revealed || [];
  // Griglia unica da 14 colonne con posizionamento esplicito: le righe
  // 1 e 4 (12 caselle) occupano le colonne 2-13, così tutte le caselle
  // hanno la stessa dimensione e le righe 2 e 3 sporgono di una casella
  // a sinistra e a destra. Il posizionamento esplicito evita che il
  // flusso automatico della griglia sposti le celle nelle colonne libere.
  layoutBoardRows(frase).forEach((row, ri) => {
    row.forEach((cell, ci) => {
      const d = document.createElement("div");
      if (cell.type === "letter") {
        const ch = frase[cell.phraseIndex];
        if (!isLetterChar(ch)) {
          d.className = "board-cell board-symbol";
          d.textContent = ch;
        } else if (revealed[cell.phraseIndex]) {
          d.className = "board-cell board-revealed";
          d.textContent = ch;
        } else {
          d.className = "board-cell board-covered";
          d.textContent = "";
        }
      } else if (cell.type === "space") {
        d.className = "board-cell board-space";
        d.textContent = "";
      } else {
        d.className = "board-cell board-empty";
        d.textContent = "";
      }
      d.style.gridRowStart = String(ri + 1);
      d.style.gridColumnStart = String(ci + (ri === 0 || ri === 3 ? 2 : 1));
      el.board.appendChild(d);
    });
  });
}

// Distribuisce la frase sulle righe 12/14/14/12 del tabellone:
// la parola che sfora va per intero sulla riga successiva.
function layoutBoardRows(frase) {
  const rows = BOARD_ROW_CAPACITIES.map(() => []);
  const words = [];
  let i = 0;
  while (i < frase.length) {
    if (frase[i] === " ") { i++; continue; }
    let j = i;
    while (j < frase.length && frase[j] !== " ") j++;
    words.push({ text: frase.slice(i, j), start: i });
    i = j;
  }
  let r = 0;
  let col = 0;
  const lastRow = rows.length - 1;
  const newRow = () => { r = Math.min(r + 1, lastRow); col = 0; };
  words.forEach((w) => {
    const L = w.text.length;
    if (col > 0 && col + 1 + L > BOARD_ROW_CAPACITIES[r]) newRow();
    if (col > 0) { rows[r].push({ type: "space" }); col++; }
    if (L <= BOARD_ROW_CAPACITIES[r]) {
      for (let k = 0; k < L; k++) rows[r].push({ type: "letter", phraseIndex: w.start + k });
      col += L;
    } else {
      // Fallback: parola più lunga della riga, si spezza (non deve capitare con frasi <= 52)
      let k = 0;
      while (k < L) {
        const room = BOARD_ROW_CAPACITIES[r] - col;
        if (room <= 0) {
          if (r === lastRow) break;
          newRow();
          continue;
        }
        const take = Math.min(L - k, room);
        for (let t = 0; t < take; t++) { rows[r].push({ type: "letter", phraseIndex: w.start + k }); k++; col++; }
        if (k < L) newRow();
      }
    }
  });
  rows.forEach((row, ri) => {
    while (row.length < BOARD_ROW_CAPACITIES[ri]) row.push({ type: "filler" });
  });
  return rows;
}

function segmentColor(seg) {
  if (seg.type === "bancarotta") return "#111827";
  if (seg.type === "passamano") return "#FFFFFF";
  if (seg.special) return "#A855F7";
  const v = seg.value;
  const palette = { 100: "#DBEAFE", 200: "#BFDBFE", 300: "#93C5FD", 400: "#60A5FA", 500: "#34D399", 600: "#FBBF24", 700: "#FB923C", 800: "#F87171" };
  return palette[v] || "#E5E7EB";
}

function segmentTextColor(seg) {
  if (seg.type === "bancarotta") return "#FFFFFF";
  return "#111827";
}

function renderWheel() {
  if (!el.wheel || !gameState || !gameState.wheel) return;
  // Costruisci i segmenti solo se cambiano (per non resettare la rotazione).
  // Gli ancoraggi sono proporzionali al raggio reale così le etichette
  // restano dentro la ruota su ogni viewport (incluso dopo un resize).
  const wheelSize = el.wheel.clientWidth || 320;
  const builtKey = String(gameState.roundNumber) + ":" + gameState.wheel.length + ":" + wheelSize;
  if (el.wheel.dataset.built !== builtKey) {
    el.wheel.innerHTML = "";
    const n = gameState.wheel.length;
    const wheelR = wheelSize / 2;
    // Unico ancoraggio per tutte le etichette: la prima riga (la più
    // esterna) parte sempre alla stessa distanza dal bordo esterno.
    const outerDy = -(wheelR * 0.94);
    const gradient = gameState.wheel.map((seg, i) => {
      const c = segmentColor(seg);
      const a0 = (i * 360) / n;
      const a1 = ((i + 1) * 360) / n;
      return c + " " + a0 + "deg " + a1 + "deg";
    }).join(", ");
    el.wheel.style.background = "conic-gradient(" + gradient + ")";
    gameState.wheel.forEach((seg, i) => {
      const isWord = seg.type === "bancarotta" || seg.type === "passamano";
      const label = document.createElement("div");
      label.className = "wheel-label";
      const angle = (i * 360) / n + 360 / n / 2;
      label.style.transform = "rotate(" + angle + "deg) translateY(" + outerDy + "px)";
      const digits = document.createElement("div");
      digits.className = "wheel-digits" + (isWord ? " wheel-word" : "") + (seg.type === "bancarotta" ? " wheel-bancarotta" : "") + (seg.type === "passamano" ? " wheel-passa" : "");
      digits.style.color = segmentTextColor(seg);
      digits.title = seg.label;
      // Cifre/parole in verticale: la più esterna è la prima a sinistra
      String(seg.label).split("").forEach((ch) => {
        const s = document.createElement("span");
        s.textContent = ch;
        digits.appendChild(s);
      });
      if (!isWord) {
        const euro = document.createElement("span");
        euro.className = "wheel-euro";
        euro.textContent = "€";
        digits.appendChild(euro);
      }
      label.appendChild(digits);
      el.wheel.appendChild(label);
    });
    el.wheel.dataset.built = builtKey;
  }
  // Animazione verso lastSpin
  const spin = gameState.lastSpin;
  if (spin && spin.nonce !== lastSeenNonce) {
    lastSeenNonce = spin.nonce;
    const n = gameState.wheel.length;
    const segAngle = 360 / n;
    // Il pointer è in alto (0deg). Lo spicchio i copre [i*segAngle, (i+1)*segAngle).
    const desiredMod = ((360 - (spin.index * segAngle + segAngle / 2)) % 360 + 360) % 360;
    const currentMod = ((currentRotation % 360) + 360) % 360;
    const delta = ((desiredMod - currentMod) + 360) % 360;
    currentRotation = currentRotation + 5 * 360 + delta;
    el.wheel.style.transition = "transform 4s cubic-bezier(0.15, 0.85, 0.25, 1)";
    el.wheel.style.transform = "rotate(" + currentRotation + "deg)";
    if (spinAnimTimeout) clearTimeout(spinAnimTimeout);
    spinAnimTimeout = setTimeout(() => {
      showSpinResult(spin);
    }, 4100);
  }
  if (!spin && el.spinResult) {
    el.spinResult.textContent = "";
  } else if (spin && spin.nonce === lastSeenNonce && el.spinResult && !el.spinResult.textContent) {
    showSpinResult(spin);
  }
  if (el.pendingValueInfo) {
    if (gameState.pendingValue !== null && gameState.pendingValue !== undefined) {
      el.pendingValueInfo.textContent = "Valore giocato: " + gameState.pendingValue + "€ — chiama una CONSONANTE (soluzione bloccata fino alla chiamata)";
    } else if (gameState.phase === "playing") {
      el.pendingValueInfo.textContent = isMyTurn() ? "Gira la ruota, oppure compra una vocale (500€), oppure risolvi." : "";
    } else {
      el.pendingValueInfo.textContent = "";
    }
  }
}

function showSpinResult(spin) {
  if (!el.spinResult) return;
  if (spin.type === "bancarotta") el.spinResult.textContent = "💥 BANCAROTTA! Montepremi azzerato.";
  else if (spin.type === "passamano") el.spinResult.textContent = "⏭ PASSA! Tocca al prossimo.";
  else el.spinResult.textContent = "🎯 " + spin.label + "€" + (spin.special ? " (casella speciale!)" : "");
}

function renderControls() {
  if (!gameState) return;
  const mine = isMyTurn() && gameState.phase === "playing";
  if (el.spinBtn) el.spinBtn.disabled = !mine || gameState.pendingValue !== null;
  // La soluzione si può dare solo prima di girare la ruota
  if (el.solveBtn) el.solveBtn.disabled = !mine || gameState.pendingValue !== null;
  if (!el.keyboard) return;
  if (el.keyboard.dataset.built !== "1") {
    el.keyboard.innerHTML = "";
    ALPHABET.forEach((letter) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key-btn";
      b.dataset.letter = letter;
      b.textContent = letter;
      b.addEventListener("click", () => {
        socket.emit("ruotaCallLetter", GAME_ID, letter, myPlayerId || getStored("playerId"));
      });
      el.keyboard.appendChild(b);
    });
    el.keyboard.dataset.built = "1";
  }
  const me = myPlayer();
  const canAffordVowel = me && (me.roundPot || 0) >= (gameState.vowelCost || 500);
  Array.from(el.keyboard.children).forEach((b) => {
    const letter = b.dataset.letter;
    const called = (gameState.calledLetters || []).includes(letter);
    const vowel = VOWELS.includes(letter);
    let disabled = true;
    let cls = "key-btn";
    if (called) {
      disabled = true;
      cls += " key-called";
    } else if (!mine) {
      disabled = true;
    } else if (gameState.pendingValue !== null) {
      // Dopo lo spin: solo consonanti
      disabled = vowel;
      if (!vowel) cls += " key-consonant";
    } else {
      // Prima dello spin: solo vocali acquistabili
      disabled = !vowel || !canAffordVowel;
      if (vowel && canAffordVowel) cls += " key-vowel";
    }
    if (!disabled && mine) cls += " key-active";
    b.disabled = disabled;
    b.className = cls;
  });
}

function renderRoundEnd() {
  if (!el.roundEndText || !gameState) return;
  if (gameState.phase === "roundEnd") {
    const banked = gameState.lastBanked;
    let gainText = "Guadagno del round";
    if (banked && banked.playerName) gainText += " di " + banked.playerName;
    gainText += ": " + (banked ? banked.amount : 0) + "€";
    el.roundEndText.textContent = "Round " + gameState.roundNumber + " risolto! " + gainText + ". Premi per continuare.";
    if (el.roundEndScores) {
      el.roundEndScores.innerHTML = "";
      gameState.players.forEach((p) => {
        const d = document.createElement("div");
        d.className = "bg-white rounded-lg p-2 border border-gray-300 text-center";
        d.innerHTML = "<strong>" + escapeHtml(p.name) + "</strong>: " + (p.totalPot || 0) + "€ totali";
        el.roundEndScores.appendChild(d);
      });
    }
  }
}

function renderVictory() {
  if (!gameState || gameState.phase !== "ended") return;
  if (el.victoryScores) {
    el.victoryScores.innerHTML = "";
    const sorted = [...gameState.players].sort((a, b) => (b.totalPot || 0) - (a.totalPot || 0));
    sorted.forEach((p) => {
      const d = document.createElement("div");
      d.className = "bg-white rounded-lg p-3 border-2 border-gray-300 text-center text-lg";
      d.innerHTML = "<strong>" + escapeHtml(p.name) + "</strong>: " + (p.totalPot || 0) + "€";
      el.victoryScores.appendChild(d);
    });
  }
  if (el.winnerText) {
    if (gameState.winner) {
      el.winnerText.textContent = gameState.winner.tie ? gameState.winner.text : "🏆 Vince " + gameState.winner.text + "!";
    } else {
      el.winnerText.textContent = "Partita completata!";
    }
  }
}

function updateReadyButton() {
  if (!el.readyBtn || !gameState) return;
  if (gameState.phase !== "lobby") return;
  const myId = myPlayerId || getStored("playerId") || mySocketId;
  const me = gameState.players.find((p) => p.id === myId);
  const hasName = el.playerName && el.playerName.value.trim().length > 0;
  if (gameState.players.length >= 4 && !me) {
    el.readyBtn.disabled = true;
    el.readyBtn.innerHTML = "Stanza piena";
    return;
  }
  if (!me && !hasName) {
    el.readyBtn.disabled = true;
    return;
  }
  el.readyBtn.disabled = false;
  if (me && me.ready) {
    el.readyBtn.dataset.ready = "true";
    el.readyBtn.innerHTML = '<ion-icon name="close-outline"></ion-icon> Non pronto';
  } else {
    el.readyBtn.dataset.ready = "false";
    el.readyBtn.innerHTML = '<ion-icon name="checkmark-outline"></ion-icon> Pronto';
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Events ----------

function setupLobby() {
  if (!el.playerName) return;
  try {
    const saved = getStored("name");
    if (saved && !el.playerName.value) el.playerName.value = saved;
  } catch (e) {}
  el.playerName.addEventListener("input", () => {
    const name = el.playerName.value.trim();
    if (name) {
      setStored("name", name);
      socket.emit("ruotaSetName", GAME_ID, name, myPlayerId || getStored("playerId"));
    }
    updateReadyButton();
  });
  el.playerName.addEventListener("change", () => {
    const name = el.playerName.value.trim();
    if (name) socket.emit("ruotaSetName", GAME_ID, name, myPlayerId || getStored("playerId"));
  });
}

function setupButtons() {
  if (el.readyBtn) {
    el.readyBtn.addEventListener("click", () => {
      const name = el.playerName.value.trim() || getStored("name") || "Giocatore";
      socket.emit("ruotaSetName", GAME_ID, name, myPlayerId || getStored("playerId"));
      const isReady = el.readyBtn.dataset.ready === "true";
      socket.emit("ruotaSetReady", GAME_ID, !isReady, myPlayerId || getStored("playerId"));
    });
  }
  if (el.spinBtn) {
    el.spinBtn.addEventListener("click", () => {
      socket.emit("ruotaSpin", GAME_ID, myPlayerId || getStored("playerId"));
    });
  }
  if (el.solveBtn) {
    el.solveBtn.addEventListener("click", () => {
      if (el.solveModal) el.solveModal.classList.remove("hidden");
      if (el.solveInput) {
        el.solveInput.value = "";
        setTimeout(() => el.solveInput.focus(), 50);
      }
    });
  }
  if (el.solveCancel) {
    el.solveCancel.addEventListener("click", () => {
      if (el.solveModal) el.solveModal.classList.add("hidden");
    });
  }
  if (el.solveConfirm) {
    el.solveConfirm.addEventListener("click", () => {
      const v = el.solveInput ? el.solveInput.value : "";
      socket.emit("ruotaSolve", GAME_ID, v, myPlayerId || getStored("playerId"));
      if (el.solveModal) el.solveModal.classList.add("hidden");
    });
  }
  if (el.solveInput) {
    el.solveInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        socket.emit("ruotaSolve", GAME_ID, el.solveInput.value, myPlayerId || getStored("playerId"));
        if (el.solveModal) el.solveModal.classList.add("hidden");
      }
    });
  }
  const backdrop = document.getElementById("solveBackdrop");
  if (backdrop) backdrop.addEventListener("click", () => {
    if (el.solveModal) el.solveModal.classList.add("hidden");
  });
  if (el.nextRoundBtn) {
    el.nextRoundBtn.addEventListener("click", () => {
      socket.emit("ruotaNextRound", GAME_ID);
    });
  }
  if (el.restartBtn) {
    el.restartBtn.addEventListener("click", () => {
      socket.emit("ruotaReset", GAME_ID);
    });
  }
  if (el.wheelCenter) {
    el.wheelCenter.addEventListener("click", () => {
      if (el.spinBtn && !el.spinBtn.disabled) {
        socket.emit("ruotaSpin", GAME_ID, myPlayerId || getStored("playerId"));
      }
    });
  }
}

// ---------- Socket ----------

socket.on("connect", () => {
  mySocketId = socket.id;
  setBanner(false);
  joinRoom();
});

socket.on("disconnect", () => {
  setBanner(true, "Connessione persa, riconnessione...");
});

socket.io.on("reconnect_attempt", () => {
  setBanner(true, "Connessione persa, riconnessione...");
});

socket.on("ruotaRoomJoined", (data) => {
  mySocketId = data.socketId || socket.id;
  if (data.playerId) {
    myPlayerId = data.playerId;
    setStored("playerId", data.playerId);
  }
});

socket.on("ruotaState", (state) => {
  const prevPhase = gameState ? gameState.phase : null;
  gameState = state;
  setBanner(false);
  const myId = myPlayerId || getStored("playerId") || mySocketId;
  const me = state.players.find((p) => p.id === myId);
  if (me) {
    if (!myPlayerId) myPlayerId = me.id;
    if (el.playerName && !el.playerName.value && me.name) el.playerName.value = me.name;
  } else {
    try {
      const savedName = getStored("name");
      if (savedName && state.phase === "lobby" && state.players.length < 4) {
        socket.emit("ruotaSetName", GAME_ID, savedName, myId);
      }
    } catch (e) {}
  }
  // Reset animazione a cambio round
  if (prevPhase && state.roundNumber !== undefined && el.wheel) {
    if (!state.lastSpin) {
      lastSeenNonce = -1;
      currentRotation = 0;
      el.wheel.style.transition = "none";
      el.wheel.style.transform = "rotate(0deg)";
      if (el.spinResult) el.spinResult.textContent = "";
      el.wheel.dataset.built = "";
    }
  }
  render();
});

socket.on("ruotaError", (message) => {
  alert(message);
});

document.addEventListener("DOMContentLoaded", () => {
  initElements();
  myPlayerId = getStored("playerId");
  setupLobby();
  setupButtons();
  ensureBanner();
  joinRoom();
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Forza la ricostruzione delle etichette con i nuovi ancoraggi;
      // la rotazione corrente della ruota viene preservata.
      if (el.wheel) el.wheel.dataset.built = "";
      render();
    }, 200);
  });
});

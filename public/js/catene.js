"use strict";

let chains = [];
let order = [];
let orderPos = 0;

let chain = [];
let currentPos = 1;
let revealedCount = 1;
let results = [];
let finished = false;
// true quando una parola è stata rivelata tutta senza indovinarla:
// si mostra per intero e si attende il bottone "Avanti" del giocatore.
let waitingContinue = false;

// Countdown di riferimento (non vincolante): 10s, si azzera a ogni tentativo.
const GUESS_TIME = 10;
const CATENE_URL = "https://raw.githubusercontent.com/MeloDub/intesa-vincente-words/refs/heads/main/catene.json";
let timeLeft = GUESS_TIME;
let timerId = null;

const el = {};

function initElements() {
  ["loadingArea", "errorArea", "errorText", "retryBtn", "gameArea", "progressText",
    "scoreText", "chainList", "guessInput", "guessBtn", "feedbackText",
    "controlsArea", "continueArea", "continueBtn", "timerText", "timerBar",
    "victoryArea", "victorySummary", "victoryChain", "nextChainBtn"
  ].forEach((id) => {
    el[id] = document.getElementById(id);
  });
}

function normalize(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countLetters(word) {
  return String(word).replace(/ /g, "").length;
}

// Mostra solo le prime `n` lettere da sinistra, senza aggiungere nulla:
// né underscore né puntini, così la lunghezza totale resta nascosta.
function maskWord(word, n) {
  let letters = 0;
  let out = "";
  for (const ch of String(word)) {
    if (letters >= n) break;
    if (ch === " ") {
      if (out.length > 0) out += " ";
      continue;
    }
    out += ch;
    letters += 1;
  }
  return out.replace(/\s+$/, "");
}

function resetTimer() {
  timeLeft = GUESS_TIME;
  renderTimer();
}

function renderTimer() {
  if (!el.timerText) return;
  if (timeLeft > 0) {
    el.timerText.textContent = "⏱ " + timeLeft + "s";
  } else {
    el.timerText.textContent = "⏱ tempo scaduto (solo riferimento)";
  }
  el.timerText.classList.toggle("timer-danger", timeLeft <= 3);
  if (el.timerBar) {
    el.timerBar.style.width = Math.max(0, (timeLeft / GUESS_TIME) * 100) + "%";
    el.timerBar.classList.toggle("timer-bar-low", timeLeft <= 3);
  }
}

function tickTimer() {
  // Il timer è solo un riferimento: non blocca mai il gioco.
  if (finished || waitingContinue) return;
  if (!chain.length || currentPos >= chain.length) return;
  if (el.gameArea.classList.contains("hidden")) return;
  if (el.guessInput.disabled) return;
  if (timeLeft > 0) {
    timeLeft -= 1;
    renderTimer();
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickNextChain() {
  if (orderPos >= order.length) {
    order = shuffle(chains.map((_, i) => i));
    orderPos = 0;
  }
  return chains[order[orderPos++]];
}

function startChain() {
  chain = pickNextChain().slice();
  currentPos = 1;
  revealedCount = 1;
  results = ["given", ...chain.slice(1).map(() => "pending")];
  finished = false;
  waitingContinue = false;

  el.victoryArea.classList.add("hidden");
  el.gameArea.classList.remove("hidden");
  el.continueArea.classList.add("hidden");
  el.controlsArea.classList.remove("hidden");
  el.feedbackText.textContent = "";
  el.guessInput.value = "";
  el.guessInput.disabled = false;
  el.guessBtn.disabled = false;
  resetTimer();

  render();
  el.guessInput.focus();
}

function guessedCount() {
  return results.filter((r) => r === "guessed").length;
}

function autoCount() {
  return results.filter((r) => r === "auto").length;
}

function badgeFor(i) {
  if (i === 0) return { text: "INIZIALE", cls: "badge-given" };
  const r = results[i];
  if (r === "guessed") return { text: "INDOVINATA", cls: "badge-guessed" };
  if (r === "auto") return { text: "RIVELATA", cls: "badge-auto" };
  if (!finished && i === currentPos) return { text: "DA INDOVINARE", cls: "badge-current" };
  return { text: "IN ATTESA", cls: "badge-waiting" };
}

function rowHtml(i, showFull) {
  const target = chain[i];
  const badge = badgeFor(i);
  let display;
  if (showFull) {
    display = target;
  } else if (!finished && i === currentPos) {
    display = maskWord(target, revealedCount);
  } else if (i < currentPos || finished) {
    display = target;
  } else {
    display = "•••••";
  }
  const rowCls =
    i === 0 ? "is-given" :
    results[i] === "guessed" ? "is-guessed" :
    results[i] === "auto" ? "is-auto" :
    (!finished && i === currentPos) ? "is-current" : "is-waiting";
  return (
    '<div class="chain-row ' + rowCls + '">' +
      '<span class="chain-num">' + (i + 1) + "</span>" +
      '<span class="chain-mask">' + escapeHtml(display) + "</span>" +
      '<span class="chain-badge ' + badge.cls + '">' + badge.text + "</span>" +
    "</div>"
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function render() {
  el.chainList.innerHTML = chain.map((_, i) => {
    const showFull = i < currentPos || finished || i === 0 || (waitingContinue && i === currentPos);
    return rowHtml(i, showFull);
  }).join("");
  if (!finished) {
    el.progressText.textContent = "Parola " + (currentPos + 1) + " di " + chain.length;
  }
  el.scoreText.textContent = "Indovinate: " + guessedCount() + " · Rivelate: " + autoCount();
}

function renderVictory() {
  el.victoryChain.innerHTML = chain.map((_, i) => rowHtml(i, true)).join("");
  const g = guessedCount();
  el.victorySummary.textContent =
    "Hai indovinato " + g + (g === 1 ? " parola" : " parole") + " su 6." +
    (autoCount() > 0 ? " " + autoCount() + " rivelate automaticamente." : " Perfetto, nessuna rivelata!");
}

function advance() {
  currentPos += 1;
  revealedCount = 1;
  resetTimer();
  if (currentPos >= chain.length) {
    finished = true;
    el.guessInput.disabled = true;
    el.guessBtn.disabled = true;
    render();
    renderVictory();
    el.gameArea.classList.add("hidden");
    el.victoryArea.classList.remove("hidden");
    el.nextChainBtn.focus();
  } else {
    render();
  }
}

// Parola completata (indovinata o rivelata): la mostriamo per intero e
// restiamo fermi finché il giocatore preme "Avanti". Niente avanzamento automatico.
function waitContinue() {
  waitingContinue = true;
  el.guessInput.disabled = true;
  el.guessBtn.disabled = true;
  el.controlsArea.classList.add("hidden");
  const last = currentPos >= chain.length - 1;
  el.continueBtn.innerHTML = last
    ? "Mostra risultato →"
    : "Prossima parola →";
  el.continueArea.classList.remove("hidden");
  render();
  el.continueBtn.focus();
}

function onContinue() {
  if (!waitingContinue || finished) return;
  waitingContinue = false;
  el.continueArea.classList.add("hidden");
  el.controlsArea.classList.remove("hidden");
  el.feedbackText.textContent = "";
  el.guessInput.value = "";
  el.guessInput.disabled = false;
  el.guessBtn.disabled = false;
  advance();
  if (!finished) el.guessInput.focus();
}

function onGuess() {
  if (finished || waitingContinue || currentPos >= chain.length) return;
  const target = chain[currentPos];
  const attempt = normalize(el.guessInput.value);
  if (!attempt) {
    el.feedbackText.textContent = "Scrivi una parola prima di confermare.";
    return;
  }
  resetTimer();
  if (attempt === normalize(target)) {
    results[currentPos] = "guessed";
    el.feedbackText.textContent = "Esatto! 🎉";
    el.guessInput.value = "";
    waitContinue();
  } else {
    const total = countLetters(target);
    if (revealedCount + 1 >= total) {
      results[currentPos] = "auto";
      el.feedbackText.textContent = 'La parola era "' + target + '".';
      el.guessInput.value = "";
      waitContinue();
    } else {
      revealedCount += 1;
      el.feedbackText.textContent = "Sbagliato, si rivela un'altra lettera.";
      render();
      el.guessInput.focus();
      el.guessInput.select();
    }
  }
}

async function loadChains() {
  el.loadingArea.classList.remove("hidden");
  el.errorArea.classList.add("hidden");
  el.gameArea.classList.add("hidden");
  el.victoryArea.classList.add("hidden");
  try {
    const res = await fetch(CATENE_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("Formato non valido");
    // Tieni solo catene valide: array di 7 stringhe non vuote.
    chains = data.filter(
      (row) => Array.isArray(row) && row.length === 7 && row.every((w) => typeof w === "string" && w.trim())
    );
    if (chains.length === 0) throw new Error("Nessuna catena valida");
    order = shuffle(chains.map((_, i) => i));
    orderPos = 0;
    el.loadingArea.classList.add("hidden");
    startChain();
  } catch (e) {
    el.loadingArea.classList.add("hidden");
    el.errorArea.classList.remove("hidden");
    el.errorText.textContent = "Non è stato possibile caricare le catene (" + e.message + ").";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initElements();
  el.guessBtn.addEventListener("click", onGuess);
  el.guessInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onGuess();
  });
  el.continueBtn.addEventListener("click", onContinue);
  el.nextChainBtn.addEventListener("click", startChain);
  el.retryBtn.addEventListener("click", loadChains);
  resetTimer();
  timerId = setInterval(tickTimer, 1000);
  loadChains();
});

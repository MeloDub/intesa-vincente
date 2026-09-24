"use strict";

// Catene Finali: single player, interamente client-side.
// Catena di 15 parole. Da indovinare gli indici dispari fino a 11,
// poi la finale di indice 13 con terzo elemento di indice 14.

var GUESS_ORDER = [1, 3, 5, 7, 9, 11, 13];
var NORMAL_TIME = 30;
var FINAL_TIME = 100;
var JOLLY_TIME = 5;
var BOUGHT_TIME = 60;
var CATENE_FINALI_URL = "/data/catene-finali.json";

var chains = [];
var order = [];
var orderPos = 0;

var chain = [];
var pendingChain = null;
var pendingPrize = 0;
var phaseIdx = 0;
var revealedCount = 1;
var revealedFinalN = 2;
var errorsThisWord = 0;
var jollyUsedThisWord = false;
var jollies = 2;
var prize = 0;
var boughtThird = false;
var waitingContinue = false;
var finished = false;
var won = false;
// Esito delle parole dispari già chiuse: idx -> "guessed" | "auto"
var wordResults = {};

var timeTotal = NORMAL_TIME;
var timeLeft = NORMAL_TIME;
var timerId = null;

var el = {};

function initElements() {
  ["loadingArea", "errorArea", "errorText", "retryBtn",
    "startArea", "startPrize", "startBtn",
    "gameArea", "prizeText", "jollyText",
    "timerText", "timerBar", "chainList",
    "controlsArea", "guessInput", "guessBtn", "jollyBtn", "buyBtn",
    "continueArea", "continueBtn", "feedbackText",
    "endArea", "endTitle", "endSummary", "endChain", "nextChainBtn"
  ].forEach(function (id) {
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

// Prime `n` lettere da sinistra, senza underscore/puntini:
// la lunghezza totale resta nascosta.
function maskWord(word, n) {
  var letters = 0;
  var out = "";
  var s = String(word);
  for (var k = 0; k < s.length; k++) {
    var ch = s[k];
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

// Finale (indice 13): prime `n` lettere + ultima lettera,
// concatenate senza mostrare la lunghezza.
function maskFinal(word, n) {
  var s = String(word);
  var letters = s.replace(/ /g, "");
  var total = letters.length;
  if (total === 0) return "";
  if (n >= total) return s;
  var prefix = maskWord(s, n);
  var last = letters.charAt(letters.length - 1);
  return prefix + last;
}

function formatPrize(p) {
  return Number(p || 0).toLocaleString("it-IT") + "€";
}

function halvePrize(p) {
  return Math.ceil(p / 2);
}

function randomPrize() {
  return 80000 + 1000 * Math.floor(Math.random() * 61);
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function pickNextChain() {
  if (orderPos >= order.length) {
    order = shuffle(chains.map(function (_, i) { return i; }));
    orderPos = 0;
  }
  return chains[order[orderPos++]];
}

function currentGuessIdx() {
  return GUESS_ORDER[Math.min(phaseIdx, GUESS_ORDER.length - 1)];
}

function isFinalPhase() {
  return phaseIdx >= GUESS_ORDER.length - 1;
}

function maxVisibleEven() {
  var g = currentGuessIdx();
  return Math.min(g + 1, 12);
}

// ---------- Timer (solo riferimento, non blocca) ----------

function setTimer(total) {
  timeTotal = total;
  timeLeft = total;
  renderTimer();
}

function renderTimer() {
  if (!el.timerText) return;
  if (timeLeft > 0) {
    el.timerText.textContent = "⏱ " + timeLeft + "s";
  } else if (isFinalPhase()) {
    el.timerText.textContent = boughtThird
      ? "⏱ tempo scaduto: indovina la parola o hai perso"
      : "⏱ tempo scaduto: indovina oppure compra il terzo elemento";
  } else {
    el.timerText.textContent = "⏱ tempo scaduto: indovina oppure usa un jolly";
  }
  var danger = timeLeft <= 5;
  el.timerText.classList.toggle("timer-danger", danger);
  if (el.timerBar) {
    var pct = timeTotal > 0 ? Math.max(0, (timeLeft / timeTotal) * 100) : 0;
    el.timerBar.style.width = pct + "%";
    el.timerBar.classList.toggle("timer-bar-low", danger);
  }
}

function tickTimer() {
  if (finished || waitingContinue) return;
  if (!chain.length) return;
  if (!el.gameArea || el.gameArea.classList.contains("hidden")) return;
  if (el.guessInput && el.guessInput.disabled) return;
  if (timeLeft > 0) {
    timeLeft -= 1;
    renderTimer();
    // Allo scadere del timer in finale si abilita il bottone di acquisto:
    // serve un render per aggiornare il suo stato disabilitato.
    if (timeLeft === 0 && isFinalPhase() && !boughtThird && !finished) {
      render();
    }
  }
}

// ---------- Render ----------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Badge esito parola chiusa: "guessed" indovinata, "auto" sbagliata
// (tentativi esauriti), "jolly" rivelata dal jolly su parola brevissima.
function resultBadge(res) {
  if (res === "auto") return { text: "SBAGLIATA", cls: "badge-auto" };
  if (res === "jolly") return { text: "RIVELATA", cls: "badge-auto" };
  return { text: "INDOVINATA", cls: "badge-guessed" };
}

function resultIsMissed(res) {
  return res === "auto" || res === "jolly" || res === "lost";
}

function badgeFor(i) {
  if (finished) {
    if (i === 14) return { text: "TERZO ELEMENTO", cls: "badge-given" };
    if (i % 2 === 0) return { text: i === 0 ? "INIZIALE" : "VISIBILE", cls: "badge-given" };
    if (i === 13) return won ? { text: "INDOVINATA", cls: "badge-guessed" } : { text: "SBAGLIATA", cls: "badge-auto" };
    if (i % 2 === 1) return resultBadge(wordResults[i]);
    return { text: "INDOVINATA", cls: "badge-guessed" };
  }
  var g = currentGuessIdx();
  if (i === 14) {
    return boughtThird
      ? { text: "TERZO ELEMENTO", cls: "badge-given" }
      : { text: "TERZO ELEMENTO", cls: "badge-waiting" };
  }
  if (i === g) {
    // Parola appena chiusa (si attende il bottone): mostra subito l'esito.
    if (waitingContinue) {
      return resultBadge(wordResults[g]);
    }
    return i === 13
      ? { text: "FINALE · DA INDOVINARE", cls: "badge-current" }
      : { text: "DA INDOVINARE", cls: "badge-current" };
  }
  if (i % 2 === 1 && i < g) {
    return resultBadge(wordResults[i]);
  }
  if (i % 2 === 0 && i <= maxVisibleEven()) {
    return { text: i === 0 ? "INIZIALE" : "VISIBILE", cls: "badge-given" };
  }
  return { text: "IN ATTESA", cls: "badge-waiting" };
}

function displayFor(i) {
  var target = chain[i];
  if (finished) return target;
  var g = currentGuessIdx();
  if (i === 14) return boughtThird ? target : "•••••";
  if (i === g) {
    // Tentativi esauriti o parola indovinata: parola rivelata per intero nella riga.
    if (waitingContinue) return target;
    return i === 13 ? maskFinal(target, revealedFinalN) : maskWord(target, revealedCount);
  }
  if (i % 2 === 0 && i <= maxVisibleEven()) return target;
  if (i % 2 === 1 && i < g) return target;
  return "•••••";
}

// Durante il gioco mostra solo righe passate + attiva, così l'input resta vicino.
// In finale mostra solo 12, 13 e 14 (14 solo se comprato).
// A fine partita mostra tutta la catena.
function isRowVisible(i) {
  if (finished) return true;
  if (isFinalPhase()) {
    if (i === 14) return boughtThird;
    return i >= 12;
  }
  var g = currentGuessIdx();
  if (i === g) return true;
  if (i % 2 === 0 && i <= maxVisibleEven()) return true;
  if (i % 2 === 1 && i < g) return true;
  return false;
}

// Riga della finale (13) mentre è da indovinare: prime lettere a sinistra,
// ultima lettera staccata a destra vicino al badge per far capire che è finale.
function finalSplitHtml(word) {
  var total = countLetters(word);
  if (revealedFinalN >= total) {
    return '<span class="chain-mask">' + escapeHtml(String(word)) + "</span>";
  }
  var prefix = maskWord(word, revealedFinalN);
  var letters = String(word).replace(/ /g, "");
  var last = letters.charAt(letters.length - 1);
  return '<span class="chain-mask">' + escapeHtml(prefix) + "</span>" +
    '<span class="chain-final-last" title="ultima lettera">' + escapeHtml(last) + "</span>";
}

function rowHtml(i) {
  var badge = badgeFor(i);
  var display = displayFor(i);
  var g = currentGuessIdx();
  var rowCls = "is-waiting";
  if (!finished && i === g) {
    rowCls = waitingContinue
      ? (resultIsMissed(wordResults[g]) ? "is-auto" : "is-guessed")
      : "is-current";
  }
  else if (i === 14 && boughtThird) rowCls = "is-given";
  else if (i % 2 === 0 && (finished || i <= maxVisibleEven())) rowCls = "is-given";
  else if (i % 2 === 1 && (finished || i < g)) {
    rowCls = resultIsMissed(wordResults[i]) ? "is-auto" : "is-guessed";
  }
  var maskHtml;
  if (i === 13 && !finished) {
    maskHtml = finalSplitHtml(chain[i]);
  } else {
    maskHtml = '<span class="chain-mask">' + escapeHtml(display) + "</span>";
  }
  return (
    '<div class="chain-row ' + rowCls + '">' +
      '<span class="chain-num">' + (i + 1) + "</span>" +
      maskHtml +
      '<span class="chain-badge ' + badge.cls + '">' + badge.text + "</span>" +
    "</div>"
  );
}

function jollyLabel() {
  if (jollies <= 0) return "Jolly esauriti";
  return "Usa jolly";
}

// Stesso simbolo dei raddoppi di Intesa Vincente: un'icona per jolly
// rimasto, nessuna icona per quelli usati.
function jollyIconsHtml() {
  var html = "";
  for (var k = 0; k < jollies; k++) {
    html += '<ion-icon name="sparkles" class="jolly-sparkles"></ion-icon>';
  }
  return html;
}

function render() {
  var html = "";
  for (var i = 0; i < chain.length; i++) {
    if (isRowVisible(i)) html += rowHtml(i);
  }
  el.chainList.innerHTML = html;
  el.prizeText.textContent = "Montepremi: " + formatPrize(prize);
  el.jollyText.innerHTML = "Jolly: " + jollyIconsHtml();
  var locked = finished || waitingContinue;
  el.guessInput.disabled = locked;
  el.guessBtn.disabled = locked;
  el.jollyBtn.disabled = locked || isFinalPhase() || jollies <= 0 || jollyUsedThisWord || errorsThisWord > 0;
  el.jollyBtn.textContent = jollyLabel() + (jollyUsedThisWord ? " · usato qui" : "");
  if (el.buyBtn) {
    var showBuy = isFinalPhase() && !boughtThird && !finished;
    el.buyBtn.classList.toggle("hidden", !showBuy);
    // Acquisto disponibile solo allo scadere dei 100 secondi per la 13.
    el.buyBtn.disabled = timeLeft > 0;
  }
  renderTimer();
}

function renderEnd() {
  el.endChain.innerHTML = chain.map(function (_, i) { return rowHtml(i); }).join("");
}

// ---------- Flusso di gioco ----------

function resetForNewGame(pickedChain, pickedPrize) {
  chain = pickedChain.slice();
  prize = pickedPrize;
  phaseIdx = 0;
  revealedCount = 1;
  revealedFinalN = 2;
  errorsThisWord = 0;
  jollyUsedThisWord = false;
  jollies = 2;
  boughtThird = false;
  waitingContinue = false;
  finished = false;
  won = false;
  wordResults = {};

  el.startArea.classList.add("hidden");
  el.endArea.classList.add("hidden");
  el.gameArea.classList.remove("hidden");
  el.continueArea.classList.add("hidden");
  el.controlsArea.classList.remove("hidden");
  el.feedbackText.textContent = "";
  el.guessInput.value = "";
  el.guessInput.disabled = false;
  el.guessBtn.disabled = false;
  setTimer(NORMAL_TIME);
  render();
  el.guessInput.focus();
}

function enterPhase() {
  waitingContinue = false;
  el.continueArea.classList.add("hidden");
  el.controlsArea.classList.remove("hidden");
  el.feedbackText.textContent = "";
  el.guessInput.value = "";
  el.guessInput.disabled = false;
  el.guessBtn.disabled = false;
  jollyUsedThisWord = false;
  if (isFinalPhase()) {
    revealedFinalN = 2;
    boughtThird = false;
    // Con entrambi i jolly: solo il terzo elemento rivelato gratis e senza
    // dimezzare. La 13 resta da indovinare con le lettere standard.
    if (jollies === 2) {
      boughtThird = true;
    }
    setTimer(FINAL_TIME);
  } else {
    revealedCount = 1;
    errorsThisWord = 0;
    setTimer(NORMAL_TIME);
  }
  render();
  if (isFinalPhase() && jollies === 2) {
    el.feedbackText.textContent = "Bonus: hai conservato entrambi i jolly! Terzo elemento rivelato gratis, senza dimezzare il montepremi.";
  }
  el.guessInput.focus();
}

function waitContinue() {
  waitingContinue = true;
  el.guessInput.disabled = true;
  el.guessBtn.disabled = true;
  el.controlsArea.classList.add("hidden");
  el.continueBtn.textContent = phaseIdx >= GUESS_ORDER.length - 2
    ? "Vai all'ultima parola →"
    : "Prossima parola →";
  el.continueArea.classList.remove("hidden");
  render();
  // Anti-skip: il bottone resta disabilitato ~1s così un secondo Invio
  // ravvicinato (o la ripetizione del tasto) non fa avanzare subito.
  el.continueBtn.disabled = true;
  setTimeout(function () {
    if (waitingContinue && !finished) {
      el.continueBtn.disabled = false;
      el.continueBtn.focus();
    }
  }, 1000);
}

function onContinue() {
  if (!waitingContinue || finished) return;
  if (el.continueBtn.disabled) return;
  phaseIdx += 1;
  enterPhase();
}

function onGuess() {
  if (finished || waitingContinue || !chain.length) return;
  if (isFinalPhase()) {
    onGuessFinal();
    return;
  }
  var target = chain[currentGuessIdx()];
  var attempt = normalize(el.guessInput.value);
  if (!attempt) {
    el.feedbackText.textContent = "Scrivi una parola prima di confermare.";
    return;
  }
  if (attempt === normalize(target)) {
    wordResults[currentGuessIdx()] = "guessed";
    el.feedbackText.textContent = "Esatto! 🎉 Montepremi preservato.";
    el.guessInput.value = "";
    waitContinue();
  } else {
    prize = halvePrize(prize);
    revealedCount += 1;
    errorsThisWord += 1;
    var total = countLetters(target);
    if (errorsThisWord >= 2 || revealedCount >= total) {
      wordResults[currentGuessIdx()] = "auto";
      el.feedbackText.textContent = 'Sbagliato. La parola era "' + target + '". Montepremi dimezzato.';
      el.guessInput.value = "";
      waitContinue();
    } else {
      el.feedbackText.textContent = "Sbagliato: montepremi dimezzato a " + formatPrize(prize) + ", nuova lettera rivelata.";
      render();
      el.guessInput.focus();
      el.guessInput.select();
    }
  }
}

function onGuessFinal() {
  var target = chain[13];
  var attempt = normalize(el.guessInput.value);
  if (!attempt) {
    el.feedbackText.textContent = "Scrivi una parola prima di confermare.";
    return;
  }
  if (attempt === normalize(target)) {
    wordResults[13] = "guessed";
    won = true;
    finished = true;
    render();
    showEnd(true, "Hai indovinato l'ultima parola! Montepremi vinto: " + formatPrize(prize) + ".");
  } else {
    wordResults[13] = "lost";
    won = false;
    finished = true;
    prize = 0;
    render();
    showEnd(false, 'Hai sbagliato l\'ultima parola (era "' + target + '"). Montepremi perso.');
  }
}

function onJolly() {
  if (finished || waitingContinue || !chain.length) return;
  if (jollies <= 0) {
    el.feedbackText.textContent = "Jolly esauriti.";
    return;
  }
  if (jollyUsedThisWord) {
    el.feedbackText.textContent = "Massimo un jolly per parola.";
    return;
  }
  // I jolly non si possono usare per la parola finale.
  if (isFinalPhase()) {
    el.feedbackText.textContent = "I jolly non si possono usare per la parola finale.";
    return;
  }
  // Il jolly si può usare solo al primo tentativo di ogni parola.
  if (errorsThisWord > 0) {
    el.feedbackText.textContent = "Il jolly si può usare solo al primo tentativo di ogni parola.";
    return;
  }
  jollies -= 1;
  jollyUsedThisWord = true;
  revealedCount += 1;
  var total = countLetters(chain[currentGuessIdx()]);
  // Parola brevissima completata dal jolly: va mostrata e si avanza col bottone.
  if (revealedCount >= total) {
    wordResults[currentGuessIdx()] = "jolly";
    el.feedbackText.textContent = 'Jolly usato: la parola era "' + chain[currentGuessIdx()] + '".';
    el.guessInput.value = "";
    setTimer(JOLLY_TIME);
    waitContinue();
    return;
  }
  setTimer(JOLLY_TIME);
  el.feedbackText.textContent = "Jolly usato: lettera rivelata senza dimezzare. Hai 5 secondi per indovinare!";
  render();
  el.guessInput.focus();
}

function onBuy() {
  if (finished || waitingContinue || !chain.length) return;
  if (!isFinalPhase() || boughtThird) return;
  if (timeLeft > 0) {
    el.feedbackText.textContent = "Il terzo elemento si può comprare solo allo scadere dei 100 secondi.";
    return;
  }
  prize = halvePrize(prize);
  boughtThird = true;
  setTimer(BOUGHT_TIME);
  el.feedbackText.textContent = "Terzo elemento rivelato al costo di metà montepremi (" + formatPrize(prize) + " rimasti). Hai 60 secondi per indovinare!";
  render();
  el.guessInput.focus();
}

function showEnd(hasWon, summary) {
  el.gameArea.classList.add("hidden");
  el.endArea.classList.remove("hidden");
  el.endTitle.textContent = hasWon ? "Hai vinto! 🎉" : "Hai perso 😞";
  el.endSummary.textContent = summary;
  renderEnd();
  // Anti-skip: evita che un secondo Invio ravvicinato (o la ripetizione
  // del tasto) avvii subito una nuova partita senza mostrare il riepilogo.
  el.nextChainBtn.disabled = true;
  setTimeout(function () {
    el.nextChainBtn.disabled = false;
    el.nextChainBtn.focus();
  }, 1500);
}

// ---------- Caricamento ----------

function loadChains() {
  el.loadingArea.classList.remove("hidden");
  el.errorArea.classList.add("hidden");
  el.startArea.classList.add("hidden");
  el.gameArea.classList.add("hidden");
  el.endArea.classList.add("hidden");
  fetch(CATENE_FINALI_URL).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function (data) {
    if (!Array.isArray(data) || data.length === 0) throw new Error("Formato non valido");
    chains = data.filter(function (row) {
      return Array.isArray(row) && row.length === 15 &&
        row.every(function (w) { return typeof w === "string" && w.trim(); });
    });
    if (chains.length === 0) throw new Error("Nessuna catena valida");
    order = shuffle(chains.map(function (_, i) { return i; }));
    orderPos = 0;
    pendingChain = pickNextChain().slice();
    pendingPrize = randomPrize();
    el.loadingArea.classList.add("hidden");
    el.startArea.classList.remove("hidden");
    el.startPrize.textContent = formatPrize(pendingPrize);
    el.startBtn.focus();
  }).catch(function (e) {
    el.loadingArea.classList.add("hidden");
    el.errorArea.classList.remove("hidden");
    el.errorText.textContent = "Non è stato possibile caricare le catene (" + e.message + ").";
  });
}

document.addEventListener("DOMContentLoaded", function () {
  initElements();
  el.guessBtn.addEventListener("click", onGuess);
  el.guessInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") onGuess();
  });
  el.jollyBtn.addEventListener("click", onJolly);
  if (el.buyBtn) el.buyBtn.addEventListener("click", onBuy);
  el.continueBtn.addEventListener("click", onContinue);
  el.startBtn.addEventListener("click", function () {
    if (!pendingChain) return;
    resetForNewGame(pendingChain, pendingPrize);
  });
  el.nextChainBtn.addEventListener("click", function () {
    if (el.nextChainBtn.disabled) return;
    resetForNewGame(pickNextChain().slice(), randomPrize());
  });
  el.retryBtn.addEventListener("click", loadChains);
  setTimer(NORMAL_TIME);
  timerId = setInterval(tickTimer, 1000);
  loadChains();
});

# Piano: Aggiunta Selezione Giochi + Taboo a Intesa Vincente

## Panoramica
Espandere il progetto "Intesa Vincente" aggiungendo:
1. Pagina di selezione giochi
2. Gioco Taboo (4 giocatori, 2 squadre da 2)

## Stack Tecnologico
- Server: NodeJS + Express
- Real-time: Socket.io
- Template: PUG
- Styling: TailwindCSS
- Parole Taboo: File JSON locale

## Struttura Directory Target

```
views/
├── select.pug              # Nuova: selezione gioco
├── index.pug               # Esistente (da aggiornare)
├── game.pug                # Esistente (Intesa Vincente)
└── taboo/
    ├── game.pug            # Nuova: layout base
    ├── player.pug          # Nuova: vista giocatore (mostra tutto)
    └── guesser.pug         # Nuova: vista indovinatore (nasconde parola)

public/js/
├── game.js                 # Esistente
├── dictionary.js           # Esistente
├── taboo.js                # Nuova: logica Taboo
└── taboo-words.js          # Nuova: gestione parole

public/data/
└── taboo-words.json        # Nuova: parole Taboo (locali)
```

## Rotte HTTP

| Rotta | Descrizione |
|-------|-------------|
| `GET /` | Pagina selezione giochi |
| `GET /game` | Crea stanza Intesa Vincente |
| `GET /game/:uuid` | Modalità per stanza Intesa Vincente |
| `GET /game/:uuid/:mode` | Game view (mode: default/buttons) |
| `GET /taboo` | Crea stanza Taboo |
| `GET /taboo/:uuid` | Modalità per stanza Taboo |
| `GET /taboo/:uuid/:mode` | Game view (mode: player/guesser) |

## Socket Events per Taboo

| Evento | Direzione | Descrizione |
|--------|-----------|-------------|
| `joinRoom` | Client → Server | Giocatore entra nella stanza |
| `setPlayerName` | Client → Server | Imposta nome giocatore |
| `setTeam` | Client → Server | Giocatore sceglie squadra (A/B) |
| `playerReady` | Client → Server | Giocatore pronto |
| `startGame` | Server → Client | Avvio partita |
| `correctAnswer` | Client → Server | Risposta corretta (+1 team) |
| `wrongAnswer` | Client → Server | Risposta sbagliata |
| `tabooViolation` | Client → Server | Ha detto parola taboo (-1 team) |
| `skipWord` | Client → Server | Salta parola corrente |
| `nextTurn` | Server → Client | Passa turno all'altra squadra |
| `updateState` | Bidirezionale | Stato completo broadcast |
| `rotateDescriptor` | Server → Client | Nuovo descrittore (round-robin) |

## Struttura Dati Taboo (Server-side)

```javascript
{
  roomID: "uuid",
  players: [
    { id: "socket-id", name: "Player 1", team: "A", ready: true },
    { id: "socket-id", name: "Player 2", team: "A", ready: true },
    { id: "socket-id", name: "Player 3", team: "B", ready: true },
    { id: "socket-id", name: "Player 4", team: "B", ready: true }
  ],
  teams: {
    A: { score: 0, descriptorIndex: 0, players: [0, 1] },
    B: { score: 0, descriptorIndex: 0, players: [2, 3] }
  },
  currentWord: { word: "CASA", taboo: ["APPARTAMENTO", "MURO", "TETTO", "FINESTRA", "PORTA"] },
  usedWords: [],
  currentTurn: "A",
  roundNumber: 1,
  totalRounds: 3,
  timer: 60,
  gameState: "waiting" | "lobby" | "playing" | "paused" | "ended"
}
```

## Formato Parole Taboo (taboo-words.json)

```json
[
  {
    "word": "CASA",
    "taboo": ["APPARTAMENTO", "MURO", "TETTO", "FINESTRA", "PORTA"]
  }
]
```

## Flusso di Gioco Taboo

### 1. Creazione Stanza
```
/taboo → genera UUID → /taboo/:uuid
```

### 2. Lobby (gameState: "lobby")
- Max 4 giocatori si uniscono alla stanza
- Ogni giocatore imposta il proprio nome
- Ogni giocatore sceglie: Squadra A o Squadra B
- Quando 4 giocatori hanno selezionato la squadra, il gioco può iniziare
- Pulsante "Inizia Partita" disponibile

### 3. Assegnazione Ruoli (automatico)
```
Team A: Player 1 = Descriptor, Player 2 = Guesser
Team B: Player 3 = Descriptor, Player 4 = Guesser
```

### 4. Turno di Gioco (60 secondi)
| Vista | Contenuto |
|-------|-----------|
| DESCRIPTOR (mode: player) | Parola grande + Lista taboo evidenziati in rosso |
| GUESSER (mode: guesser) | Parola con lettere alternate nascoste (es: "C?S?") |

**Azioni disponibili:**
| Azione | Effetto |
|--------|---------|
| Corretto | +1 punto al team, nuova parola |
| Sbagliato | Nessun punto, nuova parola |
| Taboo! | -1 punto al team, penalità visiva |
| Passa | Nessun punto, nuova parola |

### 5. Rotazione Round-Robin
```
Fine turno → alterna Descriptor nel team:
Team A: Player 1 → Player 2 → Player 1 → Player 2 ...
Team B: Player 3 → Player 4 → Player 3 → Player 4 ...
```

### 6. Cambio Turno
```
Fine timer Team A → Turno Team B
Fine timer Team B → Nuovo round
```

### 7. Fine Partita
```
Dopo 3 round per team → Classifica finale
```

## UI/UX

### Colori Squadre
- Squadra A: Blu (#3B82F6)
- Squadra B: Rosso (#EF4444)

### Indicatori
- Descriptor attuale: Badge "DESCRITTORE"
- Turno attivo: Border animato
- Parole taboo: Evidenziate in rosso

## File da Creare

| File | Descrizione |
|------|-------------|
| `PLAN.md` | Questo documento |
| `views/select.pug` | Pagina selezione giochi |
| `views/taboo/game.pug` | Layout base Taboo |
| `views/taboo/player.pug` | Vista descriptor |
| `views/taboo/guesser.pug` | Vista guesser |
| `public/data/taboo-words.json` | 50+ parole con taboo |
| `public/js/taboo.js` | Logica client Taboo |
| `public/js/taboo-words.js` | Loader parole locali |

## File da Modificare

| File | Modifiche |
|------|-----------|
| `index.js` | Nuove rotte, socket events, stato stanze |
| `tailwind.config.js` | Colori squadre (A: blue, B: red) |
| `public/css/main_raw.css` | Stili Taboo |
| `views/index.pug` | Redirect a /select o aggiungi link |
| `public/manifest.json` | Aggiungi Titolo Taboo |

## Dipendenze
Nessuna nuova dipendenza necessaria. Le esistenti (express, socket.io, pug, uuid, tailwindcss) sono sufficienti.

## Verifica Implementazione
1. Costruire CSS: `npm run build`
2. Avviare server: `npm start`
3. Testare:
   - `/` mostra selezione giochi
   - `/taboo` crea stanza
   - 4 browser connessi allo stesso UUID
   - Ogni giocatore seleziona team
   - Avvio partita
   - Turno alternato tra squadre
   - Punteggi aggiornati in tempo reale

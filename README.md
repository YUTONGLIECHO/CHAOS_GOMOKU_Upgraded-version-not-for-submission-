# CHAOS GOMOKU 3D

> Five in a row. Physics optional.

This is a browser Gomoku game built with JavaScript and Three.js. It uses a
15×15 board, seven chaos skills, an AI opponent with three difficulty levels,
local two-player mode, pixel-style menus, sound, and a short intro.

Three.js is included in the project under `web-app/vendor/`, so the game does not
need a CDN for the 3D board. The font has a fallback if it cannot load.

---

## How to play

- **Goal:** connect **five** of your stones in a row — horizontal, vertical, or
  diagonal — before your opponent. Six or more in a row also wins.
- **A turn:** place one stone on an empty intersection, then optionally use **one**
  skill. Most skills end your turn and go on cooldown.
- **Vs AI:** the player is black and moves first; the AI is white.
- **No draws:** if the board fills with no winner, it clears and the match keeps
  going.
- **Camera:** left-drag orbit · wheel zoom · right/middle-drag pan. Touch: one
  finger orbit, pinch zoom, two-finger pan.
- **Keyboard:** Tab to the board, arrow keys move the cursor, **Enter / Space**
  places a stone, and **Escape** cancels skill targeting.

Skills are explained in more detail in `RULES.md`: YEET METEOR, FINDERS KEEPERS,
SPRING CLEANING, ABSOLUTE ZERO, CTRL + Z, CORPORATE RESTRUCTURING, and TABLE FLIP.

---

## Characters

Before a match you choose an avatar:

- Five player characters: Vex Cinder, Auditor Quill, Shroud, Sprocket, and Lord
  Ember.
- In local two-player mode both players choose a character. Duplicate picks are
  blocked unless "allow same character" is enabled.
- In vs-AI mode the player chooses one character; the AI uses the robot avatar.
- Doctor Beepboop is used for tutorial / hint dialogue and is not playable.
- Character choice is cosmetic. It changes the avatar and displayed name, not the
  rules, skills, AI, or balance.

Image assets live under:

```text
web-app/assets/avatars/      # the 7 PNG avatars used by the game
web-app/assets/source-art/   # original source images kept for reference
```

Character data is in `web-app/characters.js`; the selection screen and saved
selection logic are in `web-app/characterSelect.js`.

---

## Install & run

Requires **Node.js 18+**.

```bash
npm install
npm run dev
```

Then open the address printed by the dev server, usually
`http://localhost:8000`.

The game uses browser ES modules, so it should be served over `http://` rather
than opened by double-clicking `index.html`.

### Other commands

```bash
npm test           # run tests
npm run test:watch # watch tests
npm run lint       # run ESLint
npm run format     # format files with Prettier
npm run docs       # generate JSDoc pages into docs/
npm run build      # copy web-app/ into dist/
```

---

## Project structure

The runnable game is in `web-app/`. Root files are mostly setup and notes.
`index.html` loads one browser entry file, `main.js`, which starts the UI and
connects the modules together.

```text
chaos-gomoku-3d/
├── README.md
├── RULES.md
├── ARCHITECTURE.md
├── package.json
├── web-app/
│   ├── index.html
│   ├── default.css
│   ├── main.js                 # scene, camera, input, and game flow
│   ├── ChaosGomoku3D.js         # public game API
│   ├── gameLogic.js             # internal rule engine
│   ├── ai.js                    # AI move and skill choices
│   ├── characters.js
│   ├── characterSelect.js
│   ├── ui.js
│   ├── a11yBoard.js             # keyboard / screen-reader board
│   ├── audio.js
│   ├── effects.js               # 3D skill animations
│   ├── intro.js
│   ├── renderScheduler.js
│   ├── rng.js
│   ├── tests/
│   ├── assets/
│   └── vendor/three/
└── docs/                        # generated JSDoc output
```

## Game API

The main public game API is `web-app/ChaosGomoku3D.js`.

Human placement uses this action API. Some older AI and animation code still uses
the internal `Game` class directly, mostly to keep the current 3D animation flow
stable. `ARCHITECTURE.md` explains the current split.

Example:

```js
import { createGame, applyAction, place } from './ChaosGomoku3D.js';

let game = createGame('medium');
const result = applyAction(game, place(7, 7));
if (result.ok) {
  // animate result.events
}
```

## Notes

- The board rules live in `gameLogic.js`; Three.js meshes are rebuilt from that
  board state.
- `gameLogic.js`, `ChaosGomoku3D.js`, `ai.js`, `rng.js`, and `characters.js` are
  written as plain JavaScript modules that can be imported by tests without a
  browser.
- Tests use Vitest and cover the rule engine, public API, AI, characters, and
  render scheduler.
- The tests mostly import plain JavaScript modules. Browser modules such as
  `main.js`, `ui.js`, and `effects.js` are not imported by the Node tests.
- Keyboard and screen-reader support is implemented, but the screen-reader path
  should still be checked manually in a browser.
- AI-vs-AI is only used in tests. Since the real game has no draw, a test-only
  AI-vs-AI run uses a move cap.

## AI Use

The core game concept, rule design, and overall project structure were designed
by me.

During development, I used AI tools such as ChatGPT and Codex as support tools.
They helped with parts that were difficult for me to build alone, especially the
UI, the 3D board, animation effects, documentation, code review, and checking
whether the game logic was complete.

AI also helped me polish some ideas and make the project more consistent, but
the final decisions about what to include, how the game should work, and what to
submit were made by me. All AI suggestions were reviewed and edited before being
used.

See `RULES.md` for the rules and `ARCHITECTURE.md` for a simple file-by-file
overview.

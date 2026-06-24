# Chaos Gomoku 3D

**Five in a row. Physics optional.** — a 3D, browser-based Gomoku with chaotic
skills, an AI opponent, sound and a local two-player mode.

This site documents the game's **public API**. Everything the UI, AI and tests need
goes through a single stable module: **[`ChaosGomoku3D`](ChaosGomoku3D.html)**. The
internal rule engine (`gameLogic.js`) is *not* part of the public surface.

---

## Quick start

```js
import { createGame, applyAction, place, useSkill, endTurn, ERROR }
  from './ChaosGomoku3D.js';

const game = createGame('medium');           // fresh board, black to move
const res  = applyAction(game, place(7, 7)); // -> ActionResult

if (res.ok) {
  for (const ev of res.events) animate(ev);  // 'place' | 'win' | 'autoFlip' | ...
} else {
  console.warn(res.error.code, res.error.message); // e.g. ERROR.CELL_OCCUPIED
}
```

---

## Core public API

| Member | What it does |
|---|---|
| [`createGame(difficulty?)`](ChaosGomoku3D.html#.createGame) | Make a fresh game state. |
| [`applyAction(game, action, opts?)`](ChaosGomoku3D.html#.applyAction) | Validate + apply an action; returns `{ ok, state, events }` or `{ ok:false, error }`. |
| [`canApply(game, action)`](ChaosGomoku3D.html#.canApply) | Pure legality check (no mutation). |
| [`getLegalActions(game)`](ChaosGomoku3D.html#.getLegalActions) | Every legal action for the side to move. |
| [`getResult(game)`](ChaosGomoku3D.html#.getResult) · [`isGameOver`](ChaosGomoku3D.html#.isGameOver) · [`getCurrentPlayer`](ChaosGomoku3D.html#.getCurrentPlayer) | Read game status. |
| [`place`](ChaosGomoku3D.html#.place) · [`useSkill`](ChaosGomoku3D.html#.useSkill) · [`endTurn`](ChaosGomoku3D.html#.endTurn) | Action creators. |
| [`ERROR`](ChaosGomoku3D.html#.ERROR) | Stable error-code map. |

**Types:** `GameState`, `GameAction`, `PlaceAction`, `SkillAction`, `EndTurnAction`,
`ActionResult`, `ActionError`, `GameEvent` — see the **Global** section in the left nav.

---

## Running the game

The game is **not** linked from this documentation, because it must be served
over HTTP (its ES-module scripts won't run from a `file://` page). To play it
locally:

```bash
npm install
npm run dev
```

Then open the address the dev server prints (by default
`http://localhost:8000`).

---

## Links

- **Public API reference →** [`ChaosGomoku3D`](ChaosGomoku3D.html)
- **Source →** [`ChaosGomoku3D.js`](ChaosGomoku3D.js.html)
- **README →** [`readme.html`](readme.html)

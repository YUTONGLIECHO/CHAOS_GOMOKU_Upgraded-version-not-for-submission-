# Code structure — CHAOS GOMOKU 3D

This file is a short map of the project. It is not meant to describe a perfect
architecture; it just explains where the main pieces live.

## 1. Main files

| File | What it does | Uses Three.js? |
|---|---|---|
| `gameLogic.js` | The internal `Game` class: board, turns, wins, skills, cooldowns, snapshots. | No |
| `ChaosGomoku3D.js` | Public game API: `createGame`, `applyAction`, `canApply`, selectors, and action helpers. | No |
| `rng.js` | Small seeded random helper used by tests and a few random skills. | No |
| `ai.js` | Chooses AI moves and AI skill use. | No |
| `ui.js` | DOM menus, HUD, skill tray, status text, and result screen. | No |
| `a11yBoard.js` | Hidden DOM board used for keyboard and screen-reader play. | No |
| `effects.js` | 3D animations for skills, particles, shake, and related effects. | Yes |
| `intro.js` | Short opening / tutorial sequence. | A little |
| `audio.js` | WebAudio sound effects. | No |
| `main.js` | Sets up the scene, camera, input, UI, effects, and game flow. | Yes |

The board array in `gameLogic.js` is the main game state. The 3D stones are
visuals built from that state.

`index.html` loads one browser entry file: `main.js`. That file starts the app,
sets up browser events, and connects the smaller modules together.

`gameLogic.js`, `ChaosGomoku3D.js`, `ai.js`, `rng.js`, and `characters.js` are
plain JavaScript modules and do not need the DOM or Three.js. Browser-facing
files such as `main.js`, `ui.js`, `a11yBoard.js`, `characterSelect.js`,
`effects.js`, `intro.js`, and `audio.js` are allowed to use browser APIs.

The tests mostly import the plain JavaScript modules. They do not import
`main.js`, `ui.js`, `effects.js`, `intro.js`, or `audio.js`.

## 2. State model

The game uses a small mutable `Game` object. The important fields are:

| Field | Meaning |
|---|---|
| `board` | 15×15 grid: 0 empty, 1 black/player, 2 white/AI |
| `current` | side to move |
| `phase` | `menu`, `place`, or `over` |
| `winner`, `winLine` | result once a win is found |
| `cooldowns`, `usedOnce`, `frozen` | skill state |
| `placedThisTurn`, `usedSkillThisTurn` | per-turn checks |
| `turnLog` | snapshots for CTRL+Z |
| `difficulty` | AI difficulty setting |

UI-only things such as meshes, camera position, hover cell, and pending skill
targeting live in `main.js`, not in the rule engine.

## 3. Usual data flow

```text
mouse / touch / keyboard input
  -> main.js decides what the player is trying to do
  -> ChaosGomoku3D.js or gameLogic.js updates the Game object
  -> effects.js animates the result when needed
  -> ui.js and a11yBoard.js refresh from the new state
```

Human placement now goes through `applyAction(game, place(r, c))`. Some older AI
placement and skill-animation paths still call methods on the internal `Game`
class directly. That is not ideal, but it keeps the current animation flow stable
and avoids a larger rewrite right before submission.

## 4. Public game API

`ChaosGomoku3D.js` is the main API used by tests and the newer player-action path:

```text
createGame(difficulty?)           -> Game
applyAction(game, action, {rng?}) -> { ok:true, state, events } | { ok:false, error }
canApply(game, action)            -> { ok:true } | { ok:false, error }
getLegalActions(game)             -> Action[]
getCurrentPlayer(game)            -> 1 | 2
getResult(game)                   -> { winner, line } | null
isGameOver(game)                  -> boolean
place(r,c) / useSkill(id,target?) / endTurn()
```

The internal `Game` methods are still used in some places, especially in older
animation and AI code. If I continued refactoring, I would move more of those
paths through `applyAction`.

## 5. Notes on choices

- The engine is mutable. That is simpler for this project because the 3D animation
  code often needs to update the scene after a rule change.
- A full board does not create a draw. It clears the board and the game continues.
- CTRL + Z is once per game.
- Illegal clicks do not open popups. The UI gives smaller feedback such as a cell
  flash, button shake, status text, or an `aria-live` message.
- The files are kept flat inside `web-app/` because the coursework expects that
  folder and the project is still small enough to navigate.
- `audio.js` was split out of `main.js`. Some camera constants and scene setup are
  still in `main.js` because moving them would be a bigger and riskier change.

## 6. Character selection

Character selection is UI state. It changes avatars and displayed names, but it
does not change rules, skills, AI behavior, or balance.

- `characters.js` stores the player roster and NPC avatar data.
- `characterSelect.js` contains both the small pure selection helpers and the
  browser selection screen controller. The tests import only the helper
  functions; DOM work happens after the controller is built in the browser.
- `main.js` passes the chosen avatars to the HUD.
- `web-app/assets/avatars/` contains the PNGs used by the game.
- `web-app/assets/source-art/` keeps the original source images.

## 7. Things still worth checking

- The keyboard path works from the code and tests, but screen-reader behavior
  should still be checked manually in a real browser.
- `turnLog` snapshots use JSON cloning, which is fine for this small board.
- AI-vs-AI can run for a long time because there is no draw. That mode is only
  used as a capped smoke test, not as a normal game mode.

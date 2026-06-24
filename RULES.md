# CHAOS GOMOKU 3D rules

The runnable game is in `web-app/`. The main rule code is in
`web-app/gameLogic.js`, with a public action API in `web-app/ChaosGomoku3D.js`.

---

## 1. Basic terms

| Term | Meaning |
|---|---|
| Board | 15×15 grid. Coordinates are `(r, c)`, from 0 to 14. |
| Stone | `PLAYER=1` is black, `AI=2` is white, `EMPTY=0` is empty. |
| Five | Five same-colour stones in a row: horizontal, vertical, or diagonal. |
| Overline | Six or more in a row. This also counts as a win. |
| Turn | Place one stone, then optionally use one skill. |
| Cooldown | Number of that side's turns before a skill is ready again. |
| Targeted skill | A skill that needs an enemy stone target, such as YEET or FINDERS. |
| Frozen | A frozen side can place a stone but cannot use a skill for that turn. |

---

## 2. Starting setup

- The board starts empty.
- Black (`PLAYER`) moves first.
- All cooldowns start at 0.
- Once-per-game skills start unused.
- Nobody starts frozen.
- The game can be played as Player vs AI or local two-player.

---

## 3. Turn structure

1. **Start turn:** the current side becomes active. That side's cooldowns tick
   down by 1, except for the very first turn and CTRL+Z's extra turn.
2. **Place a stone:** the side must place one stone on an empty intersection.
   If that move makes five in a row, the game ends immediately.
3. **Optional skill:** after placing, the side may use one ready skill, unless
   they are frozen or the game is already over.
4. **End turn:** most skills end the turn. The player can also end the turn
   without using a skill.

CTRL+Z is the main exception: after using it, the same side gets another full
turn. CTRL+Z can only be used once per game.

---

## 4. Legal actions

- **PLACE(r, c):** the cell must be empty, in bounds, and the side must not have
  placed already this turn.
- **SKILL(id, target):** the side must have placed this turn, the skill must be
  ready, and targeted skills need a valid enemy stone.
- **END TURN:** allowed after placing, as long as no target selection is pending.

Invalid clicks or blocked actions do not change the game state. The UI gives small
feedback such as a shake, flash, status line, or screen-reader message instead of
opening an error popup.

---

## 5. Skills

| Skill | id | Cooldown | Target? | Effect | Turn result |
|---|---|---|---|---|---|
| ☄️ YEET METEOR | `yeet` | 5 | Yes | Removes the selected enemy stone. | Ends turn |
| 🧲 FINDERS KEEPERS | `finders` | 4 | Yes | Moves the selected enemy stone to a random empty cell. | Ends turn |
| 🧹 SPRING CLEANING | `spring` | 7 | No | Removes 1–3 random enemy stones. | Ends turn |
| ❄️ ABSOLUTE ZERO | `zero` | 5 | No | Freezes the opponent's next turn. | Ends turn |
| ↩️ CTRL + Z | `ctrlz` | once | No | Rewinds the opponent's previous full turn. | Keeps turn |
| 🔄 CORPORATE | `corporate` | once | No | Swaps all black and white stones. | Ends turn |
| 🪑 TABLE FLIP | `flip` | once | No | Clears the whole board. | Ends turn |

Some skills are intentionally chaotic:

- FINDERS can accidentally help the opponent if the moved stone lands somewhere
  that gives them five in a row.
- TABLE FLIP clears both players' stones, including the user's own stones.
- CORPORATE can backfire if swapping colours creates a bad board for the user.
- ZERO also blocks CTRL+Z for the frozen turn.

---

## 6. Win checks after skills

After a normal placement, only the side that just placed is checked for a win.

After a skill, the game checks the board again:

1. If CORPORATE creates five for both sides, the CORPORATE user loses.
2. If another skill somehow creates five for both sides, the skill user wins.
3. Otherwise, the side with five wins.
4. If nobody has five, play continues according to the skill's turn result.

CTRL+Z restores the board and turn state from before the opponent's previous
turn. Once-per-game skill usage is not rolled back.

---

## 7. Full board and no-draw rule

This game does not end in a draw.

If a placement fills the board and nobody has five, the board is cleared by a
system table flip. This does not use either player's TABLE FLIP skill. The same
turn continues: the player has already placed, so they may use a skill or end the
turn.

---

## 8. Examples

Symbols: `.` = empty, `X` = black/player, `O` = white/AI.

Horizontal five:

```text
X X X X X . .   <- black wins
. . O O O . .
```

CORPORATE backfire:

```text
Black uses CORPORATE. If the colour swap gives both sides five,
black loses because black used the skill.
```

CTRL+Z:

```text
White finishes a strong turn. Black uses CTRL+Z.
White's previous turn is undone, and black gets another turn.
Black cannot use CTRL+Z again this game.
```

---

## 9. Balance notes

- Overlines count as wins; there are no forbidden moves.
- Player vs AI keeps the human as black/first player.
- Local two-player uses Player One as black and Player Two as white.
- There is no resign button or turn limit; a long game can be restarted from the
  UI.

/**
 * Character roster for Chaos Gomoku 3D.
 *
 * This module is PURE DATA + a couple of pure helpers. It has no DOM and no
 * game-rule knowledge: choosing a character only changes the avatar and the
 * displayed identity, never the board rules, skills, or balance.
 *
 * @module characters
 */

/**
 * The five selectable player characters. Names and descriptions are fictional
 * and game-flavoured; they do not describe any real person or group.
 * @type {ReadonlyArray<{id:string,name:string,avatar:string,description:string}>}
 */
export const PLAYER_CHARACTERS = Object.freeze([
  Object.freeze({
    id: 'player-01',
    name: 'Vex Cinder',
    avatar: './assets/avatars/player-01.png',
    description: 'A grinning duelist who treats every match like a bar brawl.',
  }),
  Object.freeze({
    id: 'player-02',
    name: 'Auditor Quill',
    avatar: './assets/avatars/player-02.png',
    description: 'A composed strategist who files your defeat in triplicate.',
  }),
  Object.freeze({
    id: 'player-03',
    name: 'Shroud',
    avatar: './assets/avatars/player-03.png',
    description: 'A masked infiltrator who is never quite where you expect.',
  }),
  Object.freeze({
    id: 'player-04',
    name: 'Sprocket',
    avatar: './assets/avatars/player-04.png',
    description: 'A cheerful tinkerer who bolts chaos onto everything.',
  }),
  Object.freeze({
    id: 'player-05',
    name: 'Lord Ember',
    avatar: './assets/avatars/player-05.png',
    description: 'A scarred warlord who plays for keeps and for ceremony.',
  }),
]);

/**
 * Non-player avatars. The doctor fronts tutorials/hints; the robot is the AI
 * opponent. These are NOT part of the selectable player roster.
 * @type {Readonly<{doctor:string, ai:string}>}
 */
export const NPC_AVATARS = Object.freeze({
  doctor: './assets/avatars/doctor-beepboop.png',
  ai: './assets/avatars/ai-robot.png',
});

/**
 * Display metadata for the two NPCs (name + avatar), used by the HUD and
 * tutorial bubbles.
 */
export const NPC_CHARACTERS = Object.freeze({
  doctor: Object.freeze({
    id: 'doctor-beepboop',
    name: 'Doctor Beepboop',
    avatar: NPC_AVATARS.doctor,
    description: 'The lab\u2019s resident tutor and dispenser of dubious wisdom.',
  }),
  ai: Object.freeze({
    id: 'ai-robot',
    name: 'The Adversary',
    avatar: NPC_AVATARS.ai,
    description: 'A gold-masked machine that would very much like you to lose.',
  }),
});

/** The default selected character id (first in the roster). @type {string} */
export const DEFAULT_CHARACTER_ID = PLAYER_CHARACTERS[0].id;

/**
 * Look up a player character by id.
 * @param {string} id
 * @returns {{id:string,name:string,avatar:string,description:string}|null}
 */
export function getCharacter(id) {
  return PLAYER_CHARACTERS.find((c) => c.id === id) || null;
}

/**
 * @param {string} id
 * @returns {boolean} true if `id` names a real selectable player character.
 */
export function isValidCharacterId(id) {
  return PLAYER_CHARACTERS.some((c) => c.id === id);
}

/**
 * Return `id` if it is valid, otherwise the default character id.
 * @param {string} id
 * @returns {string}
 */
export function coerceCharacterId(id) {
  return isValidCharacterId(id) ? id : DEFAULT_CHARACTER_ID;
}

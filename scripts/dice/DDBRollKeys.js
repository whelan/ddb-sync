/**
 * DDB Roll Keys
 * Responsibility: Map D&D Beyond roll `action` names to dnd5e ability and skill keys
 * SOLID: Single Responsibility - one shared lookup table for every consumer
 *
 * DDB sends abilities either in full ("Wisdom") or abbreviated ("WIS") and
 * skills by their display name ("Perception", "Sleight of Hand"). Look up
 * with the lowercased action.
 *
 * NOTE: tests/integrations/MonksTokenBarBridge.test.js mirrors these tables.
 */
export const ABILITY_MAP = Object.freeze({
  'strength': 'str',
  'dexterity': 'dex',
  'constitution': 'con',
  'intelligence': 'int',
  'wisdom': 'wis',
  'charisma': 'cha',
  // Also support abbreviated forms from DDB
  'str': 'str',
  'dex': 'dex',
  'con': 'con',
  'int': 'int',
  'wis': 'wis',
  'cha': 'cha'
});

export const SKILL_MAP = Object.freeze({
  'acrobatics': 'acr',
  'animal handling': 'ani',
  'arcana': 'arc',
  'athletics': 'ath',
  'deception': 'dec',
  'history': 'his',
  'insight': 'ins',
  'intimidation': 'itm',
  'investigation': 'inv',
  'medicine': 'med',
  'nature': 'nat',
  'perception': 'prc',
  'performance': 'prf',
  'persuasion': 'per',
  'religion': 'rel',
  'sleight of hand': 'slt',
  'stealth': 'ste',
  'survival': 'sur'
});

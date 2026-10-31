import { normalizeText } from './normalize'

// Whether a verified quote is about the task it is attached to. Deterministic and word-based:
// the task name must name at least one maintenance object below, and the quote must name at
// least one of the same objects. A task whose name names no listed object cannot be checked,
// so it never counts as being about its quote.
//
// Each entry is one object; its alternatives are the words manuals use for the same part.
// Whole appliances (oven, dishwasher) and generic words (water, surface) are left out on
// purpose: they appear in quotes about every part, so they would let any quote through.
const MAINTENANCE_OBJECTS: readonly (readonly string[])[] = [
  ['filter', 'strainer', 'sieve'],
  ['sump'],
  ['spray arm'],
  ['nozzle', 'jet'],
  ['door'],
  ['gasket', 'seal'],
  ['salt'],
  ['rinse aid'],
  ['detergent'],
  ['dispenser'],
  ['drawer'],
  ['softener'],
  ['drain'],
  ['pump'],
  ['hose'],
  ['inlet'],
  ['valve'],
  ['basket'],
  ['rack'],
  ['drum'],
  ['tub'],
  ['lint', 'fluff'],
  ['coil'],
  ['condenser'],
  ['evaporator'],
  ['heat exchanger'],
  ['fan'],
  ['vent', 'duct'],
  ['grease'],
  ['tank', 'reservoir', 'container'],
  ['descale', 'descaling', 'decalcify', 'decalcifying', 'limescale'],
  ['foreign object', 'debris'],
  ['cleaning cycle', 'cleaning programme', 'cleaning program', 'maintenance wash', 'machine care', 'machinecare', 'self clean', 'self cleaning'],
  ['ice'],
  ['freezer'],
  ['defrost', 'defrosting'],
  ['burner'],
  ['grill'],
  ['shelf', 'shelves'],
  ['tray'],
  ['heating element'],
  ['bag'],
  ['dust'],
  ['brush'],
  ['roller'],
  ['battery'],
  ['cartridge'],
  ['milk', 'frother'],
  ['anode'],
  ['lamp', 'bulb'],
]

// Plural to singular, applied the same way to the vocabulary, the task name and the quote.
function singular(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2)
  if (/[^s]s$/.test(word)) return word.slice(0, -1)
  return word
}

// Padded with spaces so a term only matches whole words: " arm " is not inside " alarm ".
function words(text: string): string {
  const tokens = normalizeText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return ` ${tokens.map(singular).join(' ')} `
}

const OBJECTS = MAINTENANCE_OBJECTS.map((names) => names.map(words))

const mentions = (text: string, object: readonly string[]) => object.some((term) => text.includes(term))

export function quoteIsAboutTask(task: string, quote: string): boolean {
  const name = words(task)
  const quoted = words(quote)
  return OBJECTS.some((object) => mentions(name, object) && mentions(quoted, object))
}

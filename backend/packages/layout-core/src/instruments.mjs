/**
 * P&ID instrument symbols.
 *
 * Instruments are catalogue entries like any other equipment, but they render
 * as standard P&ID bubbles rather than machine artwork, and they carry a
 * simulated value, unit, setpoint and control mode.
 */

/** [code, name, unit, default simulated value] */
const DEFINITIONS = [
  ['FT', 'Flow transmitter', 't/h', 58],
  ['FIC', 'Flow controller', 'L/min', 12],
  ['PT', 'Pressure transmitter', 'bar', 4],
  ['PIC', 'Pressure controller', 'bar', 4],
  ['TT', 'Temperature transmitter', '°C', 42],
  ['TIC', 'Temperature controller', '°C', 40],
  ['LT', 'Level transmitter', '%', 65],
  ['LSH', 'High level switch', '', 0],
  ['LSL', 'Low level switch', '', 0],
  ['FV', 'Control valve', '%', 50],
]

const SIZE = 88

export const instruments = DEFINITIONS.map(([code, name, unit, value]) => ({
  id: `pid-${code.toLowerCase()}`,
  code,
  name,
  unit,
  value,
  category: 'Instruments',
  kind: 'instrument',
  w: SIZE,
  h: SIZE,
}))

/** The instrument definition for an equipment type, or undefined. */
export const instrumentFor = type => instruments.find(a => a.id === type)

/** A control valve: a bowtie body with a diaphragm actuator on top. */
const VALVE_BODY =
  '<path d="M12 42L44 60L76 42V78L44 60L12 78Z"/>' +
  '<path d="M44 60V30M28 30H60"/>' +
  '<path d="M28 30A16 16 0 0 1 60 30Z"/>'

/** Everything else: the standard circular instrument bubble. */
const BUBBLE = '<circle cx="44" cy="44" r="33"/>'

export function instrumentArtwork(type) {
  const instrument = instrumentFor(type)
  if (!instrument) return null

  const isValve = instrument.code === 'FV'
  // The valve's label sits above its actuator; a bubble's sits inside it.
  const labelY = isValve ? 16 : 49

  return `<g fill="white" stroke="#205a86" stroke-width="2.5">` +
    `${isValve ? VALVE_BODY : BUBBLE}` +
    `<text x="44" y="${labelY}" text-anchor="middle" fill="#205a86" stroke="none" ` +
    `font-family="Arial,sans-serif" font-size="17" font-weight="700">${instrument.code}</text>` +
    `</g>`
}

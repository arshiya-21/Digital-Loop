import { unprocessable } from '../utils/errors.js'

/**
 * SVG upload safety.
 *
 * An SVG is executable content: it can carry <script>, inline event handlers,
 * javascript: URLs, embedded HTML via <foreignObject>, and XXE through DOCTYPE
 * entities. Equipment artwork is inlined straight into the studio's canvas, so
 * anything dangerous in a file would run in the browser of every operator who
 * opens a loop that uses it.
 *
 * This module REJECTS rather than cleans. Silent cleaning hides mistakes and
 * invites bypasses; an admin uploading equipment artwork can fix the file and
 * try again. The check is an explicit deny-list of executable constructs plus
 * a requirement that the document really is an SVG.
 *
 * LIMITATION: this is text analysis, not a parser. It is appropriate for an
 * admin-only upload path behind authentication. Before exposing uploads to
 * untrusted users, add a parser-based sanitizer and serve uploaded files from
 * a separate origin with `Content-Security-Policy: sandbox`.
 */

/** Largest SVG accepted, in bytes. Equipment artwork is far smaller. */
const MAX_BYTES = 512 * 1024

const FORBIDDEN = [
  [/<\s*script\b/i, 'script element'],
  [/<\s*foreignObject\b/i, 'foreignObject element'],
  [/<\s*(iframe|embed|object|applet|audio|video)\b/i, 'embedded content element'],
  [/<\s*(handler|listener)\b/i, 'event handler element'],
  [/<\s*set\b[^>]*attributeName\s*=\s*["']?on/i, 'animated event handler'],
  [/\son[a-z]+\s*=/i, 'inline event handler attribute'],
  [/javascript\s*:/i, 'javascript: URL'],
  [/vbscript\s*:/i, 'vbscript: URL'],
  [/data\s*:\s*text\/html/i, 'data: HTML URL'],
  [/<!DOCTYPE/i, 'DOCTYPE declaration (XXE risk)'],
  [/<!ENTITY/i, 'entity declaration (XXE risk)'],
  [/expression\s*\(/i, 'CSS expression()'],
  // Remote references would phone home from every operator's browser.
  [/(?:xlink:)?href\s*=\s*["']\s*(?:https?:)?\/\//i, 'external href'],
  [/(?:xlink:)?href\s*=\s*["']\s*file:/i, 'file: href'],
  [/url\s*\(\s*["']?\s*(?:https?:)?\/\//i, 'external url() reference'],
]

const number = value => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Read intrinsic dimensions, preferring width/height and falling back to the
 * viewBox. Used as the catalogue's default placement size.
 */
function readDimensions(svg) {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] || ''
  const width = number(root.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1])
  const height = number(root.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1])
  if (width && height) return { width: Math.round(width), height: Math.round(height) }

  const viewBox = root.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) }
    }
  }
  return null
}

/**
 * Validate an uploaded SVG. Returns { svg, width, height, bytes } or throws a
 * 422 naming exactly what was rejected.
 */
export function checkSvg(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw unprocessable('svg_empty', 'No SVG content was supplied.')
  }

  const bytes = Buffer.byteLength(input, 'utf8')
  if (bytes > MAX_BYTES) {
    throw unprocessable('svg_too_large', `SVG must be smaller than ${MAX_BYTES / 1024} KB.`)
  }

  // Strip comments before scanning so a payload cannot hide behind one.
  const scanned = input.replace(/<!--[\s\S]*?-->/g, '')

  if (!/<svg[\s>]/i.test(scanned)) {
    throw unprocessable('svg_invalid', 'File does not contain an <svg> root element.')
  }

  const offences = FORBIDDEN.filter(([pattern]) => pattern.test(scanned)).map(([, label]) => label)
  if (offences.length) {
    throw unprocessable(
      'svg_unsafe',
      'This SVG contains content that is not allowed in equipment artwork.',
      { found: offences }
    )
  }

  const dimensions = readDimensions(scanned)
  if (!dimensions) {
    throw unprocessable(
      'svg_no_dimensions',
      'SVG must declare width and height, or a viewBox, so it can be placed on the canvas.'
    )
  }

  return { svg: input, bytes, ...dimensions }
}

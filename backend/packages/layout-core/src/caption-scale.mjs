/**
 * How large caption text is, relative to the layout.
 *
 * Labels, tags and value badges are drawn at a fixed size on screen, so their
 * size *in layout units* is the reciprocal of the zoom. Left unbounded, a
 * zoomed-out view would give every machine a caption many times its own width.
 *
 * `max` is the ceiling on that, and it is the single most important number for
 * how large equipment looks. The view opens fitted to a bounding box that
 * includes the captions, so bigger captions mean a wider box, a lower fitted
 * zoom, and smaller machines. Lowering the ceiling shrinks the captions, which
 * tightens the box, which raises the zoom — and the machines grow.
 *
 * The cost is that at the far end of the zoom-out range caption text gets
 * smaller on screen rather than holding at a constant size. That is the right
 * trade for a plant diagram: the equipment is the subject, and a label that is
 * wider than the machine it names is not helping anyone read it.
 *
 * Shared so the renderer and `tests/layout-fit.mjs` cannot disagree about it —
 * that checker's answers are only meaningful if it models the real clamp.
 */
export const CAPTION_SCALE = { min: 0.7, max: 2.0 }

/** Layout units per CSS pixel for caption text, at a given zoom. */
export const captionFactor = (viewWidth, stageWidth) =>
  Math.max(CAPTION_SCALE.min, Math.min(CAPTION_SCALE.max, viewWidth / stageWidth))

/**
 * How much of a caption to show, given how far out the view is.
 *
 * Twenty machines each carrying a name, an equipment tag and a live value is
 * sixty pieces of text. Fitted to a screen that is a crowd, and none of it is
 * legible anyway — so detail is dropped as the view pulls back and comes
 * straight back as it moves in:
 *
 *   full     everything: name, tag and value
 *   compact  name and value — the tag is reference detail, not a glance
 *   minimal  name only
 *
 * The thresholds are set so that the **fitted view shows everything**: the
 * name, the equipment tag and the live value. Fitted to the whole loop is the
 * view people actually work in, and all three are what they came to read.
 * Detail only starts going when the view is pulled back further than that.
 *
 * Measured against the raw layout-units-per-pixel ratio, not the clamped
 * `captionFactor` — the clamp exists to stop text growing without bound, and
 * would otherwise flatten the top of this scale.
 *
 * The thresholds overlap deliberately. Switching on a single boundary makes
 * text flicker in and out while the view settles, so each level has to be
 * left properly before the next takes over — see `detailFor`.
 */
const DETAIL_IN = { compact: 4.5, minimal: 7.0 }
const DETAIL_OUT = { compact: 4.0, minimal: 6.2 }

export function detailFor(factor, previous = 'full') {
  const past = (level, edges) => factor >= edges[level]
  // Rising: only drop detail once clearly past the threshold. Falling: only
  // restore it once clearly back inside. That gap is the hysteresis.
  if (previous === 'minimal') return past('minimal', DETAIL_OUT) ? 'minimal' : 'compact'
  if (previous === 'compact') {
    if (past('minimal', DETAIL_IN)) return 'minimal'
    return past('compact', DETAIL_OUT) ? 'compact' : 'full'
  }
  if (past('minimal', DETAIL_IN)) return 'minimal'
  return past('compact', DETAIL_IN) ? 'compact' : 'full'
}

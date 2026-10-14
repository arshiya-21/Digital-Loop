/**
 * @sandman/layout-core — the layout document model.
 *
 * Everything here is pure: no DOM, no filesystem, no network. That is what
 * lets the studio and the API share it, and it is the rule to keep when adding
 * to this package. Anything that needs a browser belongs in apps/studio;
 * anything that needs a database belongs in apps/api.
 *
 * The two consumers differ in one place only — which equipment types exist.
 * `validate(doc, knownTypes)` takes that as an argument: the studio passes its
 * bundled catalogue, the API passes the slugs in its asset table.
 */

export { flowColors, uid, port, route, bounds } from './geometry.mjs'
export { roundedRoute } from './path.mjs'
export { obstacleRect, intersects, autoPoints, autoRoute } from './router.mjs'
export { symbols, connectionStyle, validateStyle, marker, styledLine, flowChannel }
  from './connection-style.mjs'
export { instruments, instrumentFor, instrumentArtwork } from './instruments.mjs'
export { needsDataTag, dataTagOf, labelTagsOf, tagsOf, missingTags, layoutTags }
  from './data-tags.mjs'
export { DATA_SOURCE_LIMITS, badDataSource, dataSourceTag, cleanDataSource }
  from './data-source.mjs'
export { validate } from './validate.mjs'
export { sample, emptyLayout, SAMPLE_SCALE } from './sample.mjs'
export { CAPTION_SCALE, captionFactor, detailFor } from './caption-scale.mjs'

/**
 * The mandatory data-tag rule, shared by the studio and the API.
 *
 * Every equipment item must carry a data tag before its loop can be simulated
 * or published. Annotations are exempt: a text caption and a drawn shape are
 * things somebody wrote on the drawing, not plant.
 *
 * **A tag can be written two ways.** The older one is a single `dataTag` on
 * the equipment itself. The studio now also places *data labels* on a piece of
 * equipment — several of them, each with its own tag, unit and limits — and an
 * item carrying those is tagged just as surely as one with `dataTag` set.
 * Checking only `dataTag` made every loop drawn the new way unpublishable.
 *
 * The studio enforces this in the UI and the API enforces it again on publish.
 * Both call these functions, so the rule cannot drift between them.
 */

/** Drawn annotations: a caption and a shape are not equipment. */
const ANNOTATION = new Set(['text', 'shape'])

export const needsDataTag = node => !ANNOTATION.has(node.type)

/** The node's own data tag, trimmed. Empty string when it has none. */
export const dataTagOf = node => String(node.dataTag || '').trim()

/** The tags on a node's data labels, in the order they were placed. */
export const labelTagsOf = node =>
  (Array.isArray(node.dataLabels) ? node.dataLabels : [])
    .map(label => String(label?.tag || '').trim())
    .filter(Boolean)

/** Every tag a node carries, however it was written. */
export const tagsOf = node => {
  const own = dataTagOf(node)
  return own ? [own, ...labelTagsOf(node)] : labelTagsOf(node)
}

/** Equipment in `nodes` still missing a data tag. */
export const missingTags = nodes =>
  nodes.filter(node => needsDataTag(node) && tagsOf(node).length === 0)

/**
 * Every [nodeId, dataTag] pair in a layout, for the tag index.
 *
 * A node with several data labels contributes several rows — that index is
 * what a gateway subscribes to, and it needs each tag, not one per node.
 */
export const layoutTags = layout =>
  layout.nodes
    .filter(needsDataTag)
    .flatMap(node => tagsOf(node).map(tag => [node.id, tag]))

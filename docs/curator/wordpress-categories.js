// Category membership is source metadata, never a title/subject/tag guess at runtime.
export const normalizeCategory = value => String(value || '').replace(/&amp;/g, '&').trim().toLowerCase();
export const ART_CATEGORY_SLUGS = ['sketchbooks', 'self-portrait', 'final-pieces', 'graphic-design', 'comics', 'cartoons', 'travel-sketches', 'ideas-concepts', 'abandoned-works', 'other-art', 'menagerie', 'joshhead', 'sfc', 'uncategorized'];
export function wordpressArtDefinitions(feed) {
  if (feed?.schema !== 'josh-wordpress-categories-v1') return [];
  const categories = feed.categories || [];
  const membership = new Map(Object.entries(feed.memberships || {}));
  const matchesTerm = (work, category) => {
    const source = membership.get(String(work.permanentWorkId || work.id));
    if (source) return source.categories.includes(category.id);
    // Only a retained WordPress import can establish category membership this way.
    return work.provenance?.source === 'wordpress-wxr' && (work.collections || []).some(value => normalizeCategory(value) === normalizeCategory(category.name));
  };
  const display = name => name.replace(/&amp;/g, '&').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const definitions = ART_CATEGORY_SLUGS.map(slug => categories.find(category => category.slug === slug)).filter(Boolean).map(category => ({
    key: category.slug, collectionKey: `wp-category:${category.slug}`, label: display(category.name),
    sourceId: category.id, parent: category.parent,
    matches: work => matchesTerm(work, category)
  }));
  // These source art categories are flat. Preserve parent identity in the feed,
  // rather than inventing a relationship between Sketchbooks and Self Portrait.
  definitions.push({key:'unmatched',collectionKey:'wp-unmatched',label:'Not Yet Categorized',matches:work=>!definitions.slice(0,-1).some(definition=>definition.matches(work))});
  return definitions;
}

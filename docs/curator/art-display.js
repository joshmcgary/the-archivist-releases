const idOf = work => String(work.permanentWorkId || work.id);
export function verifiedArtCorrection(work, feed) {
  if (feed?.schema !== 'josh-art-display-repairs-v1') return null;
  const entry = feed.corrections?.[idOf(work)];
  if (!entry || ![entry.expected, entry.auditedFullRecord].filter(Boolean).some(version => ['title','date','updatedAt'].every(key => (work[key] || '') === (version[key] || '')))) return null;
  try { const url = new URL(entry.image); if (url.protocol !== 'https:' || url.hostname !== 'joshmcgarycom.wordpress.com') return null; } catch { return null; }
  return entry;
}
export function applyArtImageCorrection(work, feed) {
  const entry = verifiedArtCorrection(work, feed);
  return entry ? {...work, image:entry.image, _artImageCorrection:{sourcePostId:entry.sourcePostId,sourceUrl:entry.sourceUrl}} : work;
}
export function artBrowseWorks(works, feed) {
  const byId = new Map(works.map(work => [idOf(work),work]));
  const hidden = new Set();
  for (const group of feed?.duplicateGroups || []) {
    const kept = byId.get(group.keep);
    if (!kept || !verifiedArtCorrection(kept,feed)) continue;
    for (const id of group.duplicates) {
      const duplicate = byId.get(id);
      if (duplicate && verifiedArtCorrection(duplicate,feed)) hidden.add(id);
    }
  }
  // Only the current browse view is deduplicated. Full records and direct URLs survive.
  return works.filter(work => !hidden.has(idOf(work)));
}

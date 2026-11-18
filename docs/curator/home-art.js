const DAY = 86400000;
export function homeArtSelection(artWorks, pinnedIds, now = Date.now()) {
  const dated = artWorks.map(work => ({work, time: Date.parse(work.date || work.addedAt || '')}))
    .filter(item => Number.isFinite(item.time) && item.time <= now)
    .sort((a,b) => b.time - a.time || String(a.work.id).localeCompare(String(b.work.id)));
  const recent = dated.filter(item => item.time >= now - 7 * DAY);
  // During a quiet week, retain the newest artwork alongside the permanent set.
  const additions = (recent.length ? recent : dated.slice(0,1)).map(item => item.work);
  const byId = new Map(artWorks.map(work => [String(work.id), work]));
  return [...new Map([...additions, ...pinnedIds.map(id => byId.get(id)).filter(Boolean)]
    .map(work => [String(work.id), work])).values()];
}
export function publicShardUrl(work, manifest, base = '/api/docent') {
  const descriptor = manifest?.shards?.find(shard => shard.id === work.shardId);
  const revision = descriptor?.fingerprint || manifest?.corpusVersion || work.updatedAt || '';
  return `${base}/shards/${encodeURIComponent(work.shardId)}.json?v=${encodeURIComponent(revision)}`;
}

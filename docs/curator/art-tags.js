export const normalizeArtTag = value => String(value || '').replace(/&amp;/gi,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).normalize('NFKC').toLocaleLowerCase().replace(/^#+/,'').replace(/[-_./]+/g,' ').replace(/\s+/g,' ').trim();
export function combinedArtTags(work) {
  const seen=new Set();
  return [...(Array.isArray(work.tags)?work.tags:[]),...(Array.isArray(work._wordpressTags)?work._wordpressTags:[])].filter(value=>{
    if(typeof value!=='string')return false;
    const key=normalizeArtTag(value);if(!key||seen.has(key))return false;seen.add(key);return true;
  });
}
export function attachWordPressTags(work,feed) {
  const source=feed?.schema==='josh-wordpress-categories-v1'&&feed.memberships?.[String(work.permanentWorkId||work.id)];
  if(!source||!Array.isArray(source.tags))return work;
  return {...work,_wordpressTags:source.tags.map(tag=>tag.name).filter(name=>typeof name==='string'&&name.trim()),_wordpressTagProvenance:{postId:source.postId,sourceUrl:source.sourceUrl,method:source.method}};
}
// A null result leaves ordinary title/subject/metadata search unchanged.
export function explicitArtTagMatch(work,query) {
  const match=String(query||'').trim().match(/^(?:tag\s*:|#)\s*(.*)$/i);
  if(!match)return null;
  const term=normalizeArtTag(match[1].replace(/^(["'])(.*)\1$/,'$2'));
  return !term||combinedArtTags(work).some(tag=>normalizeArtTag(tag).includes(term));
}

export function attachCardPreview(work,feed) {
 const entry=feed?.schema==='josh-card-previews-v1'&&feed.images?.[String(work.permanentWorkId||work.id)];
 if(!entry||!/^\.\/preview-media\/[a-f0-9]{64}\.(?:jpg|png|webp|avif|gif)$/.test(entry.url))return work;
 if(!['title','date','updatedAt'].every(k=>(work[k]||'')===(entry.expected[k]||'')))return work;
 if(work._artImageCorrection)return work;
 return {...work,_cardPreview:entry.url};
}

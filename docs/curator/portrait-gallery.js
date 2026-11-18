// Decorative, source-tagged imagery. No guessed links into unrelated Archivist records.
let feedPromise;
let initialOffset;
export const portraitImageAllowed = value => {
  try {const u=new URL(value);return u.protocol==='https:' && /(^|\.)wordpress\.com$/.test(u.hostname);} catch {return false;}
};
export async function mountPortraitGallery(shell, isPaused) {
  const wide=matchMedia('(min-width:1100px)');
  let gallery;
  let observers=[];
  let disposed=false;
  const update=()=>{if(gallery)gallery.classList.toggle('is-paused',isPaused()||document.hidden);};
  const remove=()=>{observers.forEach(o=>o.disconnect());observers=[];gallery?.remove();gallery=null;};
  const start=async()=>{
    if(disposed||!shell.isConnected||!wide.matches){remove();return;}
    if(gallery)return;
    feedPromise ||= fetch('./self-portraits.json').then(r=>{if(!r.ok)throw Error('Portrait feed unavailable');return r.json();}).catch(()=>null);
    const feed=await feedPromise;
    if(disposed||!shell.isConnected||!wide.matches||gallery||feed?.schema!=='josh-self-portraits-v1')return;
    const items=feed.items.filter(item=>portraitImageAllowed(item.image));
    if(items.length<12)return;
    gallery=document.createElement('div');gallery.className='home-portrait-gallery';gallery.setAttribute('aria-hidden','true');
    initialOffset ??= Math.floor(Math.random()*items.length);
    let cursor=initialOffset;
    for(let side=0;side<2;side++){
      const rail=document.createElement('div');rail.className=`portrait-rail portrait-rail-${side?'right':'left'}`;
      const track=document.createElement('div');track.className='portrait-track';rail.append(track);gallery.append(rail);
      const observer=new IntersectionObserver(entries=>entries.forEach(({isIntersecting,target})=>{if(isIntersecting&&target.dataset.src){target.src=target.dataset.src;delete target.dataset.src;observer.unobserve(target);}}),{root:rail,rootMargin:'200px'});observers.push(observer);
      const fill=()=>{
        observer.disconnect();track.replaceChildren();
        const batch=Array.from({length:6},()=>items[(cursor++)%items.length]);
        // Equal-length halves make the continuous loop seamless. Only near-visible images load.
        for(const item of [...batch,...batch]){
          const frame=document.createElement('span');frame.className='portrait-frame';
          const img=document.createElement('img');img.alt='';img.decoding='async';img.loading='lazy';img.dataset.src=item.image;img.setAttribute('fetchpriority','low');img.addEventListener('error',()=>{img.style.visibility='hidden';},{once:true});frame.append(img);track.append(frame);observer.observe(img);
        }
      };
      fill();track.addEventListener('animationiteration',fill);
    }
    shell.prepend(gallery);update();
  };
  const visibility=()=>update();
  wide.addEventListener('change',start);document.addEventListener('visibilitychange',visibility);
  const detachObserver=new MutationObserver(()=>{if(!shell.isConnected)destroy();});
  function destroy(){disposed=true;remove();wide.removeEventListener('change',start);document.removeEventListener('visibilitychange',visibility);detachObserver.disconnect();}
  detachObserver.observe(shell.parentNode,{childList:true});
  start();
  return {update,destroy};
}

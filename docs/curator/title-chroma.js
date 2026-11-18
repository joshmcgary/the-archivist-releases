// Bright, restrained hues on the black masthead; no layout or content changes.
export function titleChroma(x, y) {
  x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
  return `hsl(${Math.round(35 + x * 170)} 78% ${Math.round(70 + y * 6)}%)`;
}
export function mountTitleChroma(title) {
  if (!title) return {destroy() {}};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const controller = new AbortController();
  let frame = 0, point;
  const reset = () => {cancelAnimationFrame(frame); frame = 0; title.style.removeProperty('color');};
  window.addEventListener('pointermove', event => {
    if (!title.isConnected || reduced.matches || !fine.matches || event.pointerType === 'touch') return;
    point = {x:event.clientX / Math.max(1,innerWidth),y:event.clientY / Math.max(1,innerHeight)};
    if (!frame) frame = requestAnimationFrame(() => {frame = 0;if (title.isConnected && !reduced.matches) title.style.color = titleChroma(point.x,point.y);});
  }, {passive:true,signal:controller.signal});
  window.addEventListener('blur',reset,{signal:controller.signal});
  document.documentElement.addEventListener('pointerleave',reset,{signal:controller.signal});
  reduced.addEventListener('change',reset,{signal:controller.signal});
  fine.addEventListener('change',reset,{signal:controller.signal});
  return {destroy(){controller.abort();reset();}};
}

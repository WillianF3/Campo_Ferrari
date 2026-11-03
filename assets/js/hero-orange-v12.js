/* Atmosfera do hero: interação visual independente da reserva. */
(()=>{
  const hero=document.querySelector('.hero-orange');
  if(!hero||!window.matchMedia('(pointer:fine)').matches||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  let frame=0;
  hero.addEventListener('pointermove',event=>{
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const rect=hero.getBoundingClientRect();
      const x=(event.clientX-rect.left-rect.width/2)/rect.width;
      const y=(event.clientY-rect.top-rect.height/2)/rect.height;
      hero.style.setProperty('--cf-mouse-x',`${Math.max(-24,Math.min(24,x*48))}px`);
      hero.style.setProperty('--cf-mouse-y',`${Math.max(-14,Math.min(14,y*28))}px`);
    });
  },{passive:true});
  hero.addEventListener('pointerleave',()=>{
    hero.style.setProperty('--cf-mouse-x','0px');
    hero.style.setProperty('--cf-mouse-y','0px');
  },{passive:true});
})();

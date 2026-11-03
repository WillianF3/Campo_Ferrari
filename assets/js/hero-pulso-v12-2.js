/* Hero do Campo Ferrari: visual independente de qualquer lógica de reservas. */
(()=>{
  const video=document.getElementById('cfp-hero-video');
  if(video){
    video.muted=true;
    const play=()=>{const result=video.play();if(result&&typeof result.catch==='function')result.catch(()=>{});};
    const resume=()=>{play();window.removeEventListener('pointerdown',resume);window.removeEventListener('touchstart',resume);};
    play();
    window.addEventListener('pointerdown',resume,{once:true,passive:true});
    window.addEventListener('touchstart',resume,{once:true,passive:true});
    video.addEventListener('error',()=>{video.style.visibility='hidden';});
  }
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(const node of document.querySelectorAll('.cfp-title,.cfp-subtitle')){
    let timer;
    node.addEventListener('touchstart',()=>{
      node.classList.add('is-thin');
      clearTimeout(timer);
      timer=setTimeout(()=>node.classList.remove('is-thin'),630);
    },{passive:true});
  }
})();

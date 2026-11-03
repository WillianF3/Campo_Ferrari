/** Galeria conectada ao gerenciador de fotos. Lista sempre gerada pelo PHP. */
(async function(){
  const grid=document.querySelector('#photo-grid');
  const teaser=document.querySelector('#photo-teaser-grid');
  if(!grid && !teaser)return;
  const search=document.querySelector('#photo-search');
  const count=document.querySelector('#photo-count');
  const empty=document.querySelector('#photo-empty');
  const validCode=code=>/^CF-[0-9]{3,6}$/.test(code);

  function photoCard(photo,isTeaser=false){
    const article=document.createElement(isTeaser?'a':'article');
    article.className='cf-photo-card';
    article.dataset.photoCode=photo.code;
    if(!isTeaser)article.id=photo.code;
    const link=isTeaser?article:document.createElement('a');
    if(!isTeaser){link.className='cf-photos-buy';article.append(link);}
    const message=`Olá, Campo Ferrari! Gostaria de comprar a foto ${photo.code} da galeria de jogos e receber a versão original em alta qualidade. Podem informar o valor e as condições?`;
    link.href=isTeaser?'fotos.html#'+photo.code:'https://wa.me/5549991032914?text='+encodeURIComponent(message);
    if(!isTeaser){link.target='_blank';link.rel='noopener noreferrer';}
    link.setAttribute('aria-label',isTeaser?'Ver foto '+photo.code+' na galeria':'Consultar compra da foto '+photo.code+' no WhatsApp');
    const img=document.createElement('img');
    img.src=photo.url;
    img.alt='Prévia com marca-d’água da foto '+photo.code;
    img.loading='lazy';img.decoding='async';img.draggable=false;
    img.width=600;img.height=800;
    const caption=document.createElement('span');caption.className='cf-photo-card-caption';
    const name=document.createElement('strong');name.textContent=photo.code;
    const action=document.createElement('span');action.textContent=isTeaser?'Ver foto ↗':'COMPRAR FOTO ↗';
    caption.append(name,action);link.append(img,caption);
    return article;
  }

  // Carrossel infinito da vitrine na página inicial, usando as mesmas fotos da API.
  function setupTeaserCarousel(photos){
    if(!teaser)return;
    const carousel=document.querySelector('#cf-photo-carousel');
    const viewport=carousel?.querySelector('.cf-photo-teaser-viewport');
    const controls=document.querySelector('#cf-photo-teaser-controls');
    const prev=document.querySelector('#cf-photo-teaser-prev');
    const next=document.querySelector('#cf-photo-teaser-next');
    const indicator=document.querySelector('#cf-photo-teaser-indicator');
    if(!carousel || !viewport || !controls || !prev || !next || !indicator)return;

    // Fotos mais novas primeiro; fotos adicionadas pelo administrador entram automaticamente.
    const ordered=photos.slice().reverse();
    carousel.style.setProperty('--cf-photo-total',String(Math.min(ordered.length,3)));
    if(!ordered.length){
      const note=document.createElement('p');
      note.className='muted cf-photo-teaser-empty';
      note.textContent='Novas fotos em breve. Acompanhe nossos próximos jogos!';
      teaser.replaceChildren(note);
      return;
    }
    if(ordered.length===1){
      teaser.replaceChildren(photoCard(ordered[0],true));
      return;
    }

    const count=ordered.length;
    const clones=Math.min(3,count);
    const originalCards=ordered.map(photo=>photoCard(photo,true));
    const makeClone=(card)=>{
      const clone=card.cloneNode(true);
      clone.setAttribute('aria-hidden','true');
      clone.tabIndex=-1;
      clone.removeAttribute('data-photo-code');
      return clone;
    };
    teaser.replaceChildren(
      ...originalCards.slice(-clones).map(makeClone),
      ...originalCards,
      ...originalCards.slice(0,clones).map(makeClone)
    );
    controls.hidden=false;

    let position=clones;
    let moving=false;
    let interval=null;
    let animationGuard=null;
    let queuedDirection=0;
    let touchStart=null;
    const motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
    const pause=()=>{if(interval!==null){window.clearInterval(interval);interval=null;}};
    const logicalIndex=()=>((position-clones)%count+count)%count;
    const updateIndicator=()=>{
      indicator.textContent=String(logicalIndex()+1).padStart(2,'0')+' / '+String(count).padStart(2,'0');
    };
    const moveTrack=()=>{
      const slide=teaser.querySelector('.cf-photo-card');
      if(!slide)return;
      const width=slide.getBoundingClientRect().width;
      const gap=parseFloat(window.getComputedStyle(teaser).columnGap)||0;
      teaser.style.transform='translate3d('+(-position*(width+gap))+'px,0,0)';
    };
    const snapTo=(index)=>{
      teaser.classList.remove('is-animated');
      position=index;
      moveTrack();
      // Sincroniza a posição sem animação antes de habilitar as próximas transições.
      void teaser.offsetWidth;
      teaser.classList.add('is-animated');
    };
    const go=(direction)=>{
      if(moving)return;
      moving=true;
      position+=direction;
      moveTrack();
      updateIndicator();
      if(motionQuery.matches)finishMove();
      else animationGuard=window.setTimeout(finishMove,1050); // fallback se a transição for interrompida
    };
    function finishMove(){
      window.clearTimeout(animationGuard);
      animationGuard=null;
      if(!moving)return;
      if(position>=clones+count)snapTo(position-count);
      else if(position<clones)snapTo(position+count);
      moving=false;
      updateIndicator();
      if(queuedDirection){
        const nextDirection=queuedDirection;
        queuedDirection=0;
        go(nextDirection);
      }
    }
    const play=()=>{
      pause();
      if(motionQuery.matches || document.hidden || carousel.matches(':hover') || carousel.contains(document.activeElement))return;
      interval=window.setInterval(()=>go(1),5200);
    };
    teaser.addEventListener('transitionend',event=>{
      if(event.target===teaser && event.propertyName==='transform')finishMove();
    });
    const manual=(direction)=>{
      if(moving)queuedDirection=direction;
      else go(direction);
      play();
    };
    prev.addEventListener('click',()=>manual(-1));
    next.addEventListener('click',()=>manual(1));
    carousel.addEventListener('keydown',event=>{
      if(event.key==='ArrowRight' || event.key==='ArrowLeft'){
        if(event.target instanceof HTMLElement && event.target.closest('input,textarea,select'))return;
        event.preventDefault();manual(event.key==='ArrowRight'?1:-1);
      }
    });
    viewport.addEventListener('pointerdown',event=>{
      if(event.pointerType==='touch')touchStart=event.clientX;
    },{passive:true});
    viewport.addEventListener('pointerup',event=>{
      if(event.pointerType!=='touch' || touchStart===null)return;
      const distance=event.clientX-touchStart;
      touchStart=null;
      if(Math.abs(distance)>=45)manual(distance<0?1:-1);
    },{passive:true});
    viewport.addEventListener('pointercancel',()=>{touchStart=null;});
    carousel.addEventListener('mouseenter',pause);
    carousel.addEventListener('mouseleave',play);
    carousel.addEventListener('focusin',pause);
    carousel.addEventListener('focusout',event=>{
      if(!carousel.contains(event.relatedTarget))play();
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){pause();if(moving)finishMove();}
      else play();
    });
    motionQuery.addEventListener?.('change',play);
    window.addEventListener('resize',()=>{
      if(moving){snapTo(position);moving=false;}
      else moveTrack();
    },{passive:true});

    snapTo(clones);
    updateIndicator();
    play();
  }

  function filter(){
    if(!grid)return;
    const term=(search?.value||'').trim().toUpperCase();
    let visible=0;
    for(const card of grid.children){
      card.hidden=!card.dataset.photoCode.includes(term);
      if(!card.hidden)visible++;
    }
    count.textContent=`${visible} ${visible===1?'foto disponível':'fotos disponíveis'}`;
    empty.hidden=visible!==0;
  }
  search?.addEventListener('input',filter);
  try{
    const response=await fetch('api/photos',{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('A galeria está temporariamente indisponível.');
    const data=await response.json();
    if(!Array.isArray(data))throw Error('Resposta inesperada da galeria.');
    const photos=data.filter(item=>item && validCode(item.code) && item.url===`assets/images/fotos/${item.code}.webp`);
    if(grid){
      grid.replaceChildren(...photos.map(photo=>photoCard(photo)));
      filter();
      const target=decodeURIComponent(location.hash.slice(1));
      if(validCode(target))requestAnimationFrame(()=>document.getElementById(target)?.scrollIntoView({block:'center'}));
    }
    if(teaser)setupTeaserCarousel(photos);
  }catch(error){
    const message='Não foi possível carregar as fotos agora. Atualize a página para tentar novamente.';
    if(grid){grid.replaceChildren();count.textContent='Fotos indisponíveis';empty.hidden=false;empty.textContent=message;}
    if(teaser){teaser.replaceChildren();const p=document.createElement('p');p.className='muted';p.textContent=message;teaser.append(p);}
    console.warn('Campo Ferrari: galeria indisponível',error);
  }
})();

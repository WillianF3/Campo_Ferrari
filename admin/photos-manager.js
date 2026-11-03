/** Gerenciamento de fotos: usa a sessão e CSRF já existentes no painel. */
export function createPhotoManager({api, getCsrf}) {
  const pane=document.querySelector('[data-pane="photos"]');
  const list=pane.querySelector('#admin-photo-list');
  const counter=pane.querySelector('#admin-photo-count');
  const message=pane.querySelector('#admin-photo-status');
  const form=pane.querySelector('#admin-photo-upload');
  const input=pane.querySelector('#admin-photo-files');
  const button=pane.querySelector('#admin-photo-send');
  let busy=false;

  const status=(text,error=false)=>{
    message.textContent=text;
    message.classList.toggle('has-error',error);
  };
  async function load(){
    if(busy)return;
    try{
      const photos=await api('/photos');
      list.replaceChildren();
      counter.textContent=`${photos.length} ${photos.length===1?'foto cadastrada':'fotos cadastradas'}`;
      if(!photos.length){
        const empty=document.createElement('p');empty.className='muted';
        empty.textContent='Nenhuma foto cadastrada. Envie a primeira imagem acima.';
        list.append(empty);return;
      }
      for(const photo of photos){
        if(!/^CF-[0-9]{3,6}$/.test(photo.code))continue;
        const card=document.createElement('article');card.className='admin-photo-card';
        const img=document.createElement('img');
        img.src='../'+photo.url;img.alt='Prévia da foto '+photo.code;
        img.loading='lazy';img.decoding='async';
        const foot=document.createElement('div');foot.className='admin-photo-actions';
        const name=document.createElement('strong');name.textContent=photo.code;
        const remove=document.createElement('button');remove.type='button';remove.className='danger';
        remove.textContent='Excluir foto';remove.dataset.photoDelete=photo.code;
        foot.append(name,remove);card.append(img,foot);list.append(card);
      }
    }catch(error){status(error.message||'Não foi possível carregar as fotos.',true);}
  }

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    const files=[...input.files];
    if(!files.length){status('Selecione pelo menos uma imagem.',true);return;}
    if(files.length>12){status('Envie até 12 fotos por vez.',true);return;}
    if(files.some(file=>file.size>8*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type))){
      status('São aceitos arquivos JPG, PNG ou WebP com até 8 MB cada.',true);return;
    }
    busy=true;button.disabled=true;input.disabled=true;
    let sent=0;
    try{
      for(const file of files){
        status(`Enviando ${sent+1} de ${files.length}: ${file.name}`);
        const payload=new FormData();payload.append('image',file,file.name);
        const response=await fetch('../api/admin/photos',{
          method:'POST',credentials:'same-origin',
          headers:{'Accept':'application/json','X-CSRF-Token':getCsrf()},body:payload
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(result.detail||'Não foi possível enviar '+file.name);
        sent++;
      }
      input.value='';
      status(`${sent} ${sent===1?'foto adicionada':'fotos adicionadas'}! Já aparecem na galeria pública.`);
    }catch(error){
      status(`${sent} de ${files.length} enviada(s). ${error.message}`,true);
    }finally{
      busy=false;button.disabled=false;input.disabled=false;
      await load();
    }
  });

  list.addEventListener('click',async event=>{
    const deleteButton=event.target.closest('[data-photo-delete]');
    if(!deleteButton || busy)return;
    const code=deleteButton.dataset.photoDelete;
    if(!/^CF-[0-9]{3,6}$/.test(code))return;
    if(!confirm(`Excluir permanentemente a prévia ${code} da galeria pública? A foto deixará de aparecer no site.`))return;
    busy=true;deleteButton.disabled=true;
    try{
      await api('/photos/'+code,{method:'DELETE'});
      status(`Foto ${code} excluída da galeria.`);
    }catch(error){status(error.message||'Não foi possível excluir a foto.',true);}
    finally{busy=false;await load();}
  });
  return {load};
}

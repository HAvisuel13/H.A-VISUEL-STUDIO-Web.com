
'use strict';

(() => {
  let state = { settings: {}, services: [], portfolio: [], testimonials: [] };
  let adminAuthed = false;
  let csrfToken = '';
  let editingServiceId = null;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const money = (v) => {
    if (v === undefined || v === null || v === '' || String(v).toLowerCase() === 'sur devis') return 'Sur devis';
    const n = Number(String(v).replace(/\s/g,''));
    return Number.isFinite(n) ? new Intl.NumberFormat('fr-FR').format(n) + ' FCFA' : String(v);
  };
  const fileSize = (n) => { if (!n) return '0 B'; const u=['B','KB','MB','GB']; const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),3); return (n/1024**i).toFixed(i?1:0)+' '+u[i]; };
  const toast = (msg) => { const t=$('toast'); if(!t)return; t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2600); };
  async function api(url, options={}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if ((url.startsWith('/api/admin/') || url === '/api/auth/logout') && !['GET','HEAD','OPTIONS'].includes(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    const r = await fetch(url, {credentials:'same-origin', ...options, headers});
    let body = {};
    try { body = await r.json(); } catch {}
    if (!r.ok) throw new Error(body.error || `Erreur ${r.status}`);
    return body;
  }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString('fr-FR'); }

  async function loadPublic() {
    state = await api('/api/public/bootstrap');
    renderPublic();
  }
  function renderPublic() {
    const s = state.settings;
    const clean = String(s.whatsapp || '22677967567').replace(/\D/g,'');
    $('contactAddress').textContent = s.address || 'Orodara, Burkina Faso';
    $('contactHours').textContent = s.hours || 'Sur demande — projet par projet';
    $('contactEmail').textContent = s.email || 'contact@havisuelstudio.com';
    $('contactEmail').href = 'mailto:' + (s.email || 'contact@havisuelstudio.com');
    $('contactWhatsapp').textContent = '+' + clean;
    $('contactWhatsapp').href = 'https://wa.me/' + clean;
    $('floatingWhatsapp').href = 'https://wa.me/' + clean;

    const visible = state.services;
    $('serviceGrid').innerHTML = visible.length ? visible.map(renderService).join('') :
      '<div class="empty-portfolio"><h3>Aucun service publié.</h3></div>';
    $('serviceSelect').innerHTML = '<option value="">Choisir</option>' + visible.map(x => `<option value="${x.id}">${esc(x.title)}</option>`).join('');

    renderPortfolio();
    $('testimonialGrid').innerHTML = state.testimonials.length ? state.testimonials.map(x =>
      `<article class="quote"><div class="stars">★★★★★</div><p>“${esc(x.text)}”</p><strong>${esc(x.name)}</strong><small>${esc(x.role||'Client')}</small></article>`
    ).join('') : '<div class="empty-portfolio"><h3>Aucun avis publié.</h3></div>';
  }
  function renderService(s) {
    return `<article class="service-card ${s.featured?'featured':''}" data-category="${esc(s.category)}">
      ${s.featured?'<span class="ribbon">À LA UNE</span>':''}
      <div class="service-top"><span class="service-cat">${esc(s.category)}</span><span class="muted">#${s.id}</span></div>
      <h3>${esc(s.title)}</h3><p>${esc(s.description || '')}</p>
      <div class="price">${esc(money(s.price))} ${s.unit?`<small>• ${esc(s.unit)}</small>`:''}</div>
      <div class="service-actions"><a class="btn btn-primary choose-service" data-id="${s.id}" href="#contact">Demander ce service</a><a class="btn btn-dark" href="#contact">Devis</a></div>
    </article>`;
  }
  function renderPortfolio(filter='all') {
    const items = filter==='all' ? state.portfolio : state.portfolio.filter(x=>x.category===filter);
    const grid = $('portfolioGrid');
    if(!items.length){ grid.innerHTML='<div class="empty-portfolio"><h3>Aucune réalisation dans cette catégorie.</h3></div>'; return; }
    grid.innerHTML = items.map(x => {
      const preview = x.mime.startsWith('image/') ? `<img src="${x.url}" alt="${esc(x.title)}" loading="lazy">`
        : x.mime.startsWith('video/') ? `<video src="${x.url}" controls preload="metadata"></video>`
        : `<div class="pdf-preview"><div><div class="pdf-icon">PDF</div><strong>${esc(x.title)}</strong><p style="margin-top:5px">Document</p></div></div>`;
      return `<article class="portfolio-card">
        <div class="media-preview"><span class="media-badge">${esc(x.category)}</span>${preview}</div>
        <div class="portfolio-body"><h3>${esc(x.title)}</h3><p>${esc(x.description||'')}</p>
          <div class="portfolio-meta"><span>${fmtDate(x.created_at)}</span><span>${fileSize(x.size)}</span></div>
          ${x.mime==='application/pdf'?`<a class="btn btn-dark" style="margin-top:12px;width:100%" href="${x.url}" target="_blank" rel="noopener">Ouvrir le PDF →</a>`:''}
        </div>
      </article>`;
    }).join('');
    document.querySelectorAll('.choose-service').forEach(a => a.onclick = () => {
      $('serviceSelect').value = a.dataset.id;
    });
  }

  async function loadAdmin() {
    const [services, portfolio, requests, testimonials, settings] = await Promise.all([
      api('/api/admin/services'), api('/api/admin/portfolio'), api('/api/admin/requests'),
      api('/api/admin/testimonials'), api('/api/admin/settings')
    ]);
    state.services = services.filter(x=>x.active).map(x=>({...x, description:x.description}));
    state.portfolio = portfolio;
    state.testimonials = testimonials;
    state.settings = settings;
    $('dashMedia').textContent = portfolio.length;
    $('dashServices').textContent = services.filter(x=>x.active).length;
    $('dashRequests').textContent = requests.length;
    $('dashNewRequests').textContent = requests.filter(x=>x.status==='Nouveau').length;
    renderPublic();
    renderAdminServices(services);
    renderAdminMedia(portfolio);
    renderAdminRequests(requests);
    renderAdminTestimonials(testimonials);
    $('setWhatsapp').value=settings.whatsapp||'';
    $('setEmail').value=settings.email||'';
    $('setAddress').value=settings.address||'';
    $('setHours').value=settings.hours||'';
  }

  function renderAdminMedia(items) {
    const list=$('adminMediaList');
    list.innerHTML = items.length ? items.map(x=>{
      const thumb=x.mime.startsWith('image/')?`<img class="admin-thumb" src="${x.url}" alt="">`:x.mime.startsWith('video/')?`<video class="admin-thumb" src="${x.url}" muted></video>`:`<div class="admin-thumb" style="color:var(--orange);font-weight:950">PDF</div>`;
      return `<div class="admin-row">${thumb}<div class="admin-row-info"><strong>${esc(x.title)}</strong><small>${esc(x.category)} • ${esc(x.original_name)} • ${fileSize(x.size)}</small></div><div class="admin-actions"><button class="small-btn btn-danger del-media" data-id="${x.id}" type="button">Supprimer</button></div></div>`;
    }).join('') : '<p class="muted">Aucun média.</p>';
    list.querySelectorAll('.del-media').forEach(b=>b.onclick=async()=>{if(confirm('Supprimer ce média ?')){await api('/api/admin/portfolio/'+b.dataset.id,{method:'DELETE'});await loadPublic();await loadAdmin();toast('Média supprimé')}})
  }

  function renderAdminServices(items) {
    const list=$('adminServiceList');
    list.innerHTML = items.map(x=>`<div class="admin-row"><div class="admin-row-info"><strong>${esc(x.title)}</strong><small>${esc(x.category)} • ${esc(money(x.price))}${x.unit?' • '+esc(x.unit):''} • ${x.active?'Publié':'Masqué'}</small></div><div class="admin-actions"><button class="small-btn edit-service" data-id="${x.id}" type="button">Modifier</button><button class="small-btn btn-danger del-service" data-id="${x.id}" type="button">Supprimer</button></div></div>`).join('');
    list.querySelectorAll('.edit-service').forEach(b=>b.onclick=()=>editService(Number(b.dataset.id),items));
    list.querySelectorAll('.del-service').forEach(b=>b.onclick=async()=>{if(confirm('Supprimer ce tarif ?')){await api('/api/admin/services/'+b.dataset.id,{method:'DELETE'});await loadPublic();await loadAdmin();toast('Tarif supprimé')}})
  }
  function editService(id,items) {
    const x=items.find(s=>s.id===id);if(!x)return;
    editingServiceId=id;$('serviceTitle').value=x.title;$('serviceCategory').value=x.category;$('servicePrice').value=x.price;$('serviceUnit').value=x.unit||'';$('serviceDesc').value=x.description||'';$('serviceFeatured').checked=!!x.featured;$('serviceActive').checked=!!x.active;$('cancelServiceEdit').style.display='inline-flex';
    document.querySelector('[data-view="services"]').click();$('serviceTitle').focus();
  }

  function renderAdminRequests(items) {
    const body=$('requestTableBody');
    body.innerHTML = items.length ? items.map(x=>`<tr>
      <td>${fmtDate(x.created_at)}</td><td><strong>${esc(x.name)}</strong><br><small>${esc(x.phone)}</small></td>
      <td>${esc(x.project_title)}${x.attachment_url?`<br><a href="${x.attachment_url}" target="_blank" rel="noopener">📎 ${esc(x.attachment_original_name)}</a>`:''}</td>
      <td>${esc(x.service_name||'—')}</td><td>${esc(x.budget||'—')}</td>
      <td><select class="req-status" data-id="${x.id}"><option ${x.status==='Nouveau'?'selected':''}>Nouveau</option><option ${x.status==='En cours'?'selected':''}>En cours</option><option ${x.status==='Terminé'?'selected':''}>Terminé</option><option ${x.status==='Annulé'?'selected':''}>Annulé</option></select></td>
      <td><button class="small-btn del-request" data-id="${x.id}" type="button">Supprimer</button></td></tr>`).join('') :
      '<tr><td colspan="7" class="muted">Aucune demande.</td></tr>';
    body.querySelectorAll('.req-status').forEach(s=>s.onchange=async()=>{await api('/api/admin/requests/'+s.dataset.id+'/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s.value})});await loadAdmin();toast('Statut mis à jour')});
    body.querySelectorAll('.del-request').forEach(b=>b.onclick=async()=>{if(confirm('Supprimer cette demande ?')){await api('/api/admin/requests/'+b.dataset.id,{method:'DELETE'});await loadAdmin();toast('Demande supprimée')}})
  }

  function renderAdminTestimonials(items) {
    const list=$('adminTestimonialList');
    list.innerHTML=items.map(x=>`<div class="admin-row"><div class="admin-row-info"><strong>${esc(x.name)}</strong><small>${esc(x.role||'Client')} • ${esc(x.text)}</small></div><div class="admin-actions"><button class="small-btn btn-danger del-test" data-id="${x.id}" type="button">Supprimer</button></div></div>`).join('');
    list.querySelectorAll('.del-test').forEach(b=>b.onclick=async()=>{if(confirm('Supprimer cet avis ?')){await api('/api/admin/testimonials/'+b.dataset.id,{method:'DELETE'});await loadAdmin();toast('Avis supprimé')}})
  }

  async function submitProject(e) {
    e.preventDefault();
    const fd=new FormData();
    const ids=['name','phone','email','company','serviceSelect','budget','deadline','contactMethod','projectTitle','projectMessage','reference'];
    const map={serviceSelect:'serviceId'};
    ids.forEach(id=>fd.append(map[id]||id,$(id).value.trim()));
    const selected=$('serviceSelect').selectedOptions[0];
    fd.append('consent', $('consent').checked ? 'true' : 'false');
    const file=$('projectFile').files[0];
    if(file)fd.append('attachment',file);
    try{
      const result=await api('/api/requests',{method:'POST',body:fd});
      const wa=result.whatsapp||'22677967567';
      const text=`Bonjour H.A VISUEL STUDIO,\n\nNouvelle demande de projet #${result.id}\n• Nom : ${$('name').value}\n• Téléphone : ${$('phone').value}\n• Email : ${$('email').value||'—'}\n• Service : ${selected?.textContent||'—'}\n• Budget : ${$('budget').value||'—'}\n• Délai : ${$('deadline').value||'—'}\n• Projet : ${$('projectTitle').value}\n\nDescription :\n${$('projectMessage').value}\n\nRéférence : ${$('reference').value||'—'}\n${file?`\nPièce jointe enregistrée sur le serveur : ${file.name}`:''}`;
      window.open('https://wa.me/'+String(wa).replace(/\D/g,'')+'?text='+encodeURIComponent(text),'_blank','noopener');
      $('projectForm').reset();$('formMessage').className='form-message success';$('formMessage').textContent='Demande enregistrée avec succès. WhatsApp est prêt à envoyer le récapitulatif.';toast('Demande enregistrée');
    }catch(err){$('formMessage').className='form-message error';$('formMessage').textContent=err.message}
  }

  async function login() {
    try {
      const loginResult = await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('adminUsername').value,password:$('adminPassword').value})});
      csrfToken = loginResult.csrfToken || '';
      adminAuthed=true;$('adminLogin').classList.add('hidden');$('adminPanel').classList.add('open');$('adminError').classList.add('hidden');await loadAdmin();toast('Administration ouverte');
    } catch(err){$('adminError').textContent=err.message;$('adminError').classList.remove('hidden')}
  }

  async function init() {
    $('year').textContent=new Date().getFullYear();
    $('menuBtn')?.addEventListener('click',()=>{const open=$('navLinks').classList.toggle('open');$('menuBtn').setAttribute('aria-expanded',String(open));});
    $('navLinks')?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>$('navLinks').classList.remove('open')));
    window.addEventListener('scroll',()=>$('backtop').classList.toggle('show',window.scrollY>500));
    try{await loadPublic()}catch(err){console.error(err);toast('Impossible de charger le site')}

    $('projectForm')?.addEventListener('submit',submitProject);
    $('adminLoginBtn')?.addEventListener('click',login);
    $('adminPassword')?.addEventListener('keydown',e=>{if(e.key==='Enter')login()});
    document.querySelectorAll('#portfolioFilters .filter-btn').forEach(b=>b.onclick=()=>{document.querySelectorAll('#portfolioFilters .filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderPortfolio(b.dataset.portfolioFilter)});
    document.querySelectorAll('#serviceFilters .filter-btn').forEach(b=>b.onclick=()=>{document.querySelectorAll('#serviceFilters .filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');const filter=b.dataset.serviceFilter;document.querySelectorAll('#serviceGrid .service-card').forEach(c=>{c.style.display=(filter==='all'||c.dataset.category===filter)?'':'none'});});

    $('adminLogout')?.addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});adminAuthed=false;csrfToken='';$('adminPanel').classList.remove('open');$('adminLogin').classList.remove('hidden');$('adminPassword').value='';toast('Session fermée')});

    document.querySelectorAll('.admin-tab').forEach(tab=>tab.onclick=()=>{document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');document.querySelectorAll('.admin-view').forEach(v=>v.classList.remove('open'));document.querySelector(`[data-admin-view="${tab.dataset.view}"]`).classList.add('open')});

    $('mediaFiles')?.addEventListener('change',()=>{const f=[...$('mediaFiles').files];$('selectedFiles').textContent=f.length?`${f.length} fichier(s) : ${f.map(x=>x.name).join(', ')}`:''});
    $('clearAllMedia')?.addEventListener('click',async()=>{
      if(!confirm('Cette action supprimera définitivement tous les médias du portfolio. Continuer ?')) return;
      const phrase=prompt('Pour confirmer, tapez SUPPRIMER');
      if(phrase!=='SUPPRIMER'){toast('Suppression annulée.');return;}
      try{const result=await api('/api/admin/portfolio',{method:'DELETE'});await loadAdmin();toast(`${result.deleted||0} média(s) supprimé(s)`);}catch(err){toast(err.message)}
    });
    $('saveMedia')?.addEventListener('click',async()=>{
      const files=$('mediaFiles').files;if(!files.length){toast('Sélectionnez au moins un fichier.');return}
      const fd=new FormData();fd.append('title',$('mediaTitle').value);fd.append('category',$('mediaCategory').value);fd.append('description',$('mediaDescription').value);[...files].forEach(f=>fd.append('files',f));
      const btn=$('saveMedia');btn.disabled=true;btn.textContent='Envoi…';
      try{await api('/api/admin/portfolio',{method:'POST',body:fd});$('mediaFiles').value='';$('selectedFiles').textContent='';$('mediaTitle').value='';$('mediaDescription').value='';await loadAdmin();toast('Médias ajoutés — visibles dans le portfolio public')}catch(err){toast(err.message)}finally{btn.disabled=false;btn.textContent='Ajouter au portfolio'}
    });

    $('saveService')?.addEventListener('click',async()=>{
      const payload={title:$('serviceTitle').value,category:$('serviceCategory').value,price:$('servicePrice').value,unit:$('serviceUnit').value,description:$('serviceDesc').value,featured:$('serviceFeatured').checked,active:$('serviceActive').checked};
      try{if(editingServiceId){await api('/api/admin/services/'+editingServiceId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast('Tarif modifié')}else{await api('/api/admin/services',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast('Tarif ajouté')}editingServiceId=null;$('cancelServiceEdit').style.display='none';['serviceTitle','servicePrice','serviceUnit','serviceDesc'].forEach(id=>$(id).value='');$('serviceFeatured').checked=false;$('serviceActive').checked=true;await loadAdmin()}catch(err){toast(err.message)}
    });
    $('cancelServiceEdit')?.addEventListener('click',()=>{editingServiceId=null;$('cancelServiceEdit').style.display='none'});

    $('saveTestimonial')?.addEventListener('click',async()=>{try{await api('/api/admin/testimonials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('testimonialName').value,role:$('testimonialRole').value,text:$('testimonialText').value})});$('testimonialName').value='';$('testimonialRole').value='';$('testimonialText').value='';await loadAdmin();toast('Avis ajouté')}catch(err){toast(err.message)}});

    $('saveSettings')?.addEventListener('click',async()=>{try{await api('/api/admin/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({whatsapp:$('setWhatsapp').value,email:$('setEmail').value,address:$('setAddress').value,hours:$('setHours').value})});await loadPublic();toast('Réglages enregistrés')}catch(err){toast(err.message)}});

    $('changePassword')?.addEventListener('click',async()=>{
      if($('newPassword').value!==$('newPasswordConfirm').value){toast('Les deux nouveaux mots de passe ne correspondent pas.');return}
      try{const passwordResult = await api('/api/admin/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:$('currentPassword').value,newPassword:$('newPassword').value})});
        csrfToken = passwordResult.csrfToken || csrfToken;
        $('currentPassword').value='';$('newPassword').value='';$('newPasswordConfirm').value='';toast('Mot de passe modifié avec succès')}catch(err){toast(err.message)}
    });

    $('exportRequests')?.addEventListener('click',()=>window.open('/api/admin/requests.csv','_blank'));
    $('backupExport')?.addEventListener('click',()=>window.open('/api/admin/backup.json','_blank'));
    $('backupImport')?.addEventListener('change',async()=>{
      const file=$('backupImport').files[0];
      if(!file)return;
      try{
        const text=await file.text();
        const payload=JSON.parse(text);
        if(!confirm('Restaurer cette sauvegarde ? Les services, avis et réglages actuels seront remplacés.')){ $('backupImport').value=''; return; }
        await api('/api/admin/backup/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        await loadAdmin();
        toast('Sauvegarde restaurée avec succès');
      }catch(err){toast(err.message || 'Fichier JSON invalide.');}
      finally{$('backupImport').value='';}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

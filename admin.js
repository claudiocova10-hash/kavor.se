(function(){
  'use strict';

  const config=window.KAVOR_ACCOUNT_CONFIG||{};
  let client=null;
  const state={session:null,companies:[],orders:[],tasks:[],documents:[],taskFilter:'open'};
  const $=selector=>document.querySelector(selector);
  const $$=selector=>Array.from(document.querySelectorAll(selector));
  const today=new Date();
  const todayIso=localDate(today);

  const statusLabels={
    lead:'Intresserad',active:'Aktiv kund',paused:'Pausad',
    draft:'Utkast',invoice_ready:'Fakturaunderlag klart',sent:'Faktura skickad',paid:'Betald',licenses_delivered:'Licenser levererade',cancelled:'Avbruten',
    quote_agreement:'Offert och avtal',order:'Beställning',invoice:'Faktura',license_codes:'Licenskoder',communication:'Kommunikation',other:'Övrigt'
  };

  function localDate(date){
    const shifted=new Date(date.getTime()-date.getTimezoneOffset()*60000);
    return shifted.toISOString().slice(0,10);
  }
  function formatDate(value){
    if(!value)return '–';
    return new Intl.DateTimeFormat('sv-SE',{dateStyle:'medium'}).format(new Date(`${String(value).slice(0,10)}T12:00:00`));
  }
  function formatMoney(value){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',maximumFractionDigits:2}).format(Number(value||0))}
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function companyById(id){return state.companies.find(company=>company.id===id)}
  function orderTotal(order){return Number(order.quantity||0)*Number(order.unit_price_sek||0)*(1-Number(order.discount_percent||0)/100)}
  function showMessage(text,type='success'){
    const box=$('#globalMessage');
    box.textContent=text;box.className=`global-message${type==='error'?' error':''}`;box.hidden=false;
    window.clearTimeout(showMessage.timer);showMessage.timer=window.setTimeout(()=>{box.hidden=true},5000);
  }
  function errorText(error){
    const text=String(error?.message||error||'Något gick fel.');
    if(/relation .* does not exist|Could not find the table|404/i.test(text))return 'Admin-databasen är inte installerad ännu.';
    if(/row-level security|permission denied|403/i.test(text))return 'Kontot saknar administratörsbehörighet.';
    return text;
  }
  async function currentSession(){
    const {data,error}=await client.auth.getSession();
    if(error)throw error;
    return data.session;
  }
  async function api(path,{method='GET',body,headers:extraHeaders={}}={}){
    const session=await currentSession();
    if(!session)throw new Error('Du behöver logga in.');
    const headers={...extraHeaders,apikey:config.publishableKey,Authorization:`Bearer ${session.access_token}`};
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(`${config.supabaseUrl}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();
    let data=null;
    try{data=text?JSON.parse(text):null}catch{data={message:text}}
    if(!response.ok){const error=new Error(data?.message||data?.msg||'Något gick fel.');error.status=response.status;throw error}
    return data;
  }
  async function write(path,method,body){return api(path,{method,body,headers:{Prefer:'return=representation'}})}

  async function initialize(){
    $('#todayText').textContent=new Intl.DateTimeFormat('sv-SE',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(today);
    bindEvents();
    if(!window.supabase?.createClient)throw new Error('Kavor-kontot kunde inte startas.');
    client=window.supabase.createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    state.session=await currentSession();
    if(!state.session){showLogin();return}
    $('#signedInAs').textContent=state.session.user?.email||'';
    $('#signOutButton').hidden=false;
    await enterAdmin();
  }

  function showLogin(){
    $('#loginPanel').hidden=false;$('#setupPanel').hidden=true;$('#workspace').hidden=true;$('#adminNav').hidden=true;$('#signOutButton').hidden=true;
  }
  function showSetup(message=''){ 
    $('#loginPanel').hidden=true;$('#setupPanel').hidden=false;$('#workspace').hidden=true;$('#adminNav').hidden=true;
    $('#currentUserId').textContent=state.session?.user?.id||'Okänt användar-id';
    $('#setupMessage').textContent=message;
  }
  function showWorkspace(){
    $('#loginPanel').hidden=true;$('#setupPanel').hidden=true;$('#workspace').hidden=false;$('#adminNav').hidden=false;
  }

  async function enterAdmin(){
    try{
      const userId=state.session?.user?.id;
      const rows=await api(`/rest/v1/kavor_admins?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      if(!Array.isArray(rows)||!rows.length){showSetup('Ditt konto är inloggat men ännu inte tillagt som administratör.');return}
      showWorkspace();
      await refreshData();
    }catch(error){showSetup(errorText(error))}
  }

  async function refreshData(){
    try{
      const [companies,orders,tasks,documents]=await Promise.all([
        api('/rest/v1/business_companies?select=*&order=created_at.desc'),
        api('/rest/v1/business_orders?select=*,business_companies(id,name)&order=created_at.desc'),
        api('/rest/v1/business_tasks?select=*,business_companies(id,name)&order=due_date.asc,created_at.desc'),
        api('/rest/v1/business_documents?select=*,business_companies(id,name)&order=created_at.desc')
      ]);
      state.companies=companies||[];state.orders=orders||[];state.tasks=tasks||[];state.documents=documents||[];
      renderAll();
    }catch(error){showMessage(errorText(error),'error')}
  }

  function renderAll(){renderMetrics();renderNextActions();renderPipeline();renderCompanies();renderOrders();renderTasks();renderDocuments();fillCompanySelects()}
  function renderMetrics(){
    $('#metricAction').textContent=state.orders.filter(order=>!['licenses_delivered','cancelled'].includes(order.status)).length;
    $('#metricOverdue').textContent=state.tasks.filter(task=>task.status==='open'&&task.due_date&&task.due_date<todayIso).length;
    $('#metricCompanies').textContent=state.companies.filter(company=>company.status==='active').length;
    $('#metricLicenses').textContent=state.orders.filter(order=>order.status==='licenses_delivered').reduce((sum,order)=>sum+Number(order.quantity||0),0);
  }
  function automaticOrderAction(order){
    const company=order.business_companies?.name||companyById(order.company_id)?.name||'Okänt företag';
    if(order.status==='draft')return{title:`Skapa faktura för ${company}`,detail:`${order.quantity} × ${order.package_months} månader`,kind:'order'};
    if(order.status==='invoice_ready')return{title:`Skicka faktura till ${company}`,detail:order.invoice_reference?`Fortnox ${order.invoice_reference}`:'Fakturanummer saknas',kind:'order'};
    if(order.status==='sent')return{title:`Följ upp betalning från ${company}`,detail:order.due_date?`Förfaller ${formatDate(order.due_date)}`:'Förfallodatum saknas',kind:'order',overdue:order.due_date&&order.due_date<todayIso};
    if(order.status==='paid')return{title:`Leverera ${order.quantity} licenser till ${company}`,detail:`Giltighet ${order.package_months} månader`,kind:'order'};
    return null;
  }
  function renderNextActions(){
    const tasks=state.tasks.filter(task=>task.status==='open').map(task=>({title:task.title,detail:`${task.business_companies?.name||'Allmänt'} · ${formatDate(task.due_date)}`,overdue:task.due_date&&task.due_date<todayIso,task}));
    const orderActions=state.orders.map(automaticOrderAction).filter(Boolean);
    const items=[...tasks,...orderActions].sort((a,b)=>Number(Boolean(b.overdue))-Number(Boolean(a.overdue))).slice(0,7);
    $('#nextActions').innerHTML=items.length?items.map(item=>`<div class="list-item${item.overdue?' overdue':''}"><span class="marker"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div>${item.task?`<div class="list-item-actions"><button data-complete-task="${item.task.id}">Klar</button></div>`:''}</div>`).join(''):'<div class="empty-state">Inget väntar just nu.</div>';
  }
  function renderPipeline(){
    const groups=[['draft','Utkast'],['invoice_ready','Fakturera'],['sent','Invänta betalning'],['paid','Leverera licenser']];
    $('#orderPipeline').innerHTML=groups.map(([status,label])=>`<div class="pipeline-item"><strong>${state.orders.filter(order=>order.status===status).length}</strong><span>${label}</span></div>`).join('');
  }
  function companyNextStep(company){
    const order=state.orders.find(item=>item.company_id===company.id&&!['licenses_delivered','cancelled'].includes(item.status));
    return order?statusLabels[order.status]||order.status:'Ingen aktiv beställning';
  }
  function renderCompanies(){
    const query=$('#companySearch')?.value?.trim().toLowerCase()||'';
    const filtered=state.companies.filter(company=>!query||[company.name,company.contact_name,company.billing_email,company.org_number].some(value=>String(value||'').toLowerCase().includes(query)));
    const row=company=>`<tr><td><strong>${escapeHtml(company.name)}</strong><small>${escapeHtml(company.org_number||'Organisationsnummer saknas')}</small></td><td>${escapeHtml(company.contact_name||'–')}<small>${escapeHtml(company.email||company.phone||'')}</small></td><td>${escapeHtml(company.billing_email||'–')}</td><td><span class="badge ${company.status}">${escapeHtml(statusLabels[company.status]||company.status)}</span></td><td><button class="table-action" data-edit-company="${company.id}">Redigera</button></td></tr>`;
    $('#companiesTable').innerHTML=filtered.length?filtered.map(row).join(''):'<tr><td colspan="5"><div class="empty-state">Inga företag ännu.</div></td></tr>';
    $('#recentCompanies').innerHTML=state.companies.slice(0,6).map(company=>`<tr><td><strong>${escapeHtml(company.name)}</strong><small>${escapeHtml(company.org_number||'')}</small></td><td>${escapeHtml(company.contact_name||company.email||'–')}</td><td><span class="badge ${company.status}">${escapeHtml(statusLabels[company.status]||company.status)}</span></td><td>${escapeHtml(companyNextStep(company))}</td></tr>`).join('')||'<tr><td colspan="4"><div class="empty-state">Lägg till ditt första företag.</div></td></tr>';
  }
  function renderOrders(){
    $('#ordersTable').innerHTML=state.orders.length?state.orders.map(order=>{
      const company=order.business_companies?.name||companyById(order.company_id)?.name||'Okänt företag';
      return `<tr><td><strong>${escapeHtml(company)}</strong><small>${formatDate(order.ordered_at||order.created_at)}</small></td><td>${order.quantity} × ${order.package_months} mån</td><td>${formatMoney(orderTotal(order))}<small>exkl. moms</small></td><td>${escapeHtml(order.invoice_reference||'Inte skapad')}<small>${order.due_date?`Förfall ${formatDate(order.due_date)}`:''}</small></td><td><span class="badge ${order.status}">${escapeHtml(statusLabels[order.status]||order.status)}</span></td><td><button class="table-action" data-edit-order="${order.id}">Öppna</button> <button class="table-action" data-print-order="${order.id}">Underlag</button></td></tr>`;
    }).join(''):'<tr><td colspan="6"><div class="empty-state">Inga beställningar ännu.</div></td></tr>';
  }
  function renderTasks(){
    const tasks=state.tasks.filter(task=>state.taskFilter==='all'||task.status===state.taskFilter);
    $('#tasksList').innerHTML=tasks.length?tasks.map(task=>{
      const overdue=task.status==='open'&&task.due_date&&task.due_date<todayIso;
      return `<div class="list-item${overdue?' overdue':''}${task.status==='done'?' done':''}"><span class="marker"></span><div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.business_companies?.name||'Allmänt')} · ${formatDate(task.due_date)} · ${task.priority==='high'?'Hög prioritet':task.priority==='low'?'Låg prioritet':'Normal prioritet'}${task.notes?`<br>${escapeHtml(task.notes)}`:''}</small></div><div class="list-item-actions"><button data-complete-task="${task.id}">${task.status==='done'?'Öppna igen':'Klar'}</button></div></div>`;
    }).join(''):'<div class="empty-state">Inga uppgifter i den här vyn.</div>';
  }
  function renderDocuments(){
    $('#documentsTable').innerHTML=state.documents.length?state.documents.map(document=>`<tr><td><strong>${escapeHtml(document.file_name)}</strong><small>${document.file_size?`${Math.max(1,Math.round(document.file_size/1024))} kB`:''}</small></td><td>${escapeHtml(document.business_companies?.name||companyById(document.company_id)?.name||'–')}</td><td>${escapeHtml(statusLabels[document.category]||document.category)}</td><td>${formatDate(document.created_at)}</td><td><button class="table-action" data-open-document="${document.id}">Öppna</button></td></tr>`).join(''):'<tr><td colspan="5"><div class="empty-state">Inga uppladdade dokument ännu.</div></td></tr>';
  }
  function fillCompanySelects(){
    const options=state.companies.map(company=>`<option value="${company.id}">${escapeHtml(company.name)}</option>`).join('');
    $('#orderCompany').innerHTML=`<option value="">Välj företag</option>${options}`;
    $('#documentCompany').innerHTML=`<option value="">Välj företag</option>${options}`;
    $('#taskCompany').innerHTML=`<option value="">Inget särskilt företag</option>${options}`;
  }

  function switchView(view){
    const titles={overview:'Översikt',companies:'Företag',orders:'Beställningar',tasks:'Uppgifter',documents:'Dokument'};
    $$('.view').forEach(panel=>panel.classList.toggle('active',panel.dataset.viewPanel===view));
    $$('.nav-button').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
    $('#viewTitle').textContent=titles[view]||'Översikt';
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function openCompany(company=null){
    $('#companyForm').reset();$('#companyId').value=company?.id||'';$('#companyDialogTitle').textContent=company?'Redigera företag':'Nytt företag';
    if(company){$('#companyName').value=company.name||'';$('#companyOrgNumber').value=company.org_number||'';$('#companyStatus').value=company.status||'lead';$('#companyContactName').value=company.contact_name||'';$('#companyPhone').value=company.phone||'';$('#companyEmail').value=company.email||'';$('#companyBillingEmail').value=company.billing_email||'';$('#companyAddress').value=company.billing_address||'';$('#companyPostal').value=company.postal_code||'';$('#companyCity').value=company.city||'';$('#companyNotes').value=company.notes||''}
    $('#companyDialog').showModal();
  }
  function openOrder(order=null){
    if(!state.companies.length){showMessage('Lägg till ett företag innan du skapar en beställning.','error');switchView('companies');return}
    $('#orderForm').reset();$('#orderId').value=order?.id||'';$('#orderDialogTitle').textContent=order?'Redigera beställning':'Ny beställning';fillCompanySelects();
    if(order){$('#orderCompany').value=order.company_id;$('#orderMonths').value=order.package_months;$('#orderQuantity').value=order.quantity;$('#orderUnitPrice').value=order.unit_price_sek;$('#orderDiscount').value=order.discount_percent||0;$('#orderInvoiceReference').value=order.invoice_reference||'';$('#orderDueDate').value=order.due_date||'';$('#orderStatus').value=order.status;$('#orderNotes').value=order.notes||''}
    updateOrderTotal();$('#orderDialog').showModal();
  }
  function openTask(){
    $('#taskForm').reset();fillCompanySelects();
    const due=new Date();due.setDate(due.getDate()+1);$('#taskDueDate').value=localDate(due);$('#taskDialog').showModal();
  }
  function updateOrderTotal(){
    const temp={quantity:$('#orderQuantity').value,unit_price_sek:$('#orderUnitPrice').value,discount_percent:$('#orderDiscount').value};
    $('#orderTotalPreview').textContent=formatMoney(orderTotal(temp));
  }

  async function saveCompany(event){
    event.preventDefault();
    const id=$('#companyId').value;
    const payload={name:$('#companyName').value.trim(),org_number:$('#companyOrgNumber').value.trim()||null,status:$('#companyStatus').value,contact_name:$('#companyContactName').value.trim()||null,phone:$('#companyPhone').value.trim()||null,email:$('#companyEmail').value.trim()||null,billing_email:$('#companyBillingEmail').value.trim()||null,billing_address:$('#companyAddress').value.trim()||null,postal_code:$('#companyPostal').value.trim()||null,city:$('#companyCity').value.trim()||null,notes:$('#companyNotes').value.trim()||null};
    try{
      await write(id?`/rest/v1/business_companies?id=eq.${id}`:'/rest/v1/business_companies',id?'PATCH':'POST',payload);
      $('#companyDialog').close();showMessage(id?'Företaget har uppdaterats.':'Företaget har lagts till.');await refreshData();
    }catch(error){showMessage(errorText(error),'error')}
  }
  async function saveOrder(event){
    event.preventDefault();
    const id=$('#orderId').value;
    const payload={company_id:$('#orderCompany').value,package_months:Number($('#orderMonths').value),quantity:Number($('#orderQuantity').value),unit_price_sek:Number($('#orderUnitPrice').value),discount_percent:Number($('#orderDiscount').value||0),invoice_reference:$('#orderInvoiceReference').value.trim()||null,due_date:$('#orderDueDate').value||null,status:$('#orderStatus').value,notes:$('#orderNotes').value.trim()||null};
    if(!payload.company_id){showMessage('Välj ett företag.','error');return}
    try{
      await write(id?`/rest/v1/business_orders?id=eq.${id}`:'/rest/v1/business_orders',id?'PATCH':'POST',payload);
      $('#orderDialog').close();showMessage(id?'Beställningen har uppdaterats.':'Beställningen har skapats.');await refreshData();
    }catch(error){showMessage(errorText(error),'error')}
  }
  async function saveTask(event){
    event.preventDefault();
    const payload={title:$('#taskTitle').value.trim(),company_id:$('#taskCompany').value||null,due_date:$('#taskDueDate').value,priority:$('#taskPriority').value,notes:$('#taskNotes').value.trim()||null};
    try{await write('/rest/v1/business_tasks','POST',payload);$('#taskDialog').close();showMessage('Uppgiften har lagts till.');await refreshData()}catch(error){showMessage(errorText(error),'error')}
  }
  async function toggleTask(id){
    const task=state.tasks.find(item=>item.id===id);if(!task)return;
    try{await write(`/rest/v1/business_tasks?id=eq.${id}`,'PATCH',{status:task.status==='done'?'open':'done',completed_at:task.status==='done'?null:new Date().toISOString()});await refreshData()}catch(error){showMessage(errorText(error),'error')}
  }
  function safeFileName(name){return String(name||'dokument').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'dokument'}
  async function uploadDocument(event){
    event.preventDefault();
    const file=$('#documentFile').files[0],companyId=$('#documentCompany').value,category=$('#documentCategory').value;
    if(!file||!companyId)return;
    const path=`${companyId}/${category}/${Date.now()}-${safeFileName(file.name)}`;
    const encodedPath=path.split('/').map(encodeURIComponent).join('/');
    try{
      const session=await currentSession();
      const response=await fetch(`${config.supabaseUrl}/storage/v1/object/kavor-business-documents/${encodedPath}`,{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});
      if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.message||'Uppladdningen misslyckades.')}
      await write('/rest/v1/business_documents','POST',{company_id:companyId,category,storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size});
      $('#documentDialog').close();showMessage('Dokumentet har laddats upp och sorterats.');await refreshData();
    }catch(error){showMessage(errorText(error),'error')}
  }
  async function openDocument(id){
    const document=state.documents.find(item=>item.id===id);if(!document)return;
    const encodedPath=document.storage_path.split('/').map(encodeURIComponent).join('/');
    try{
      const data=await api(`/storage/v1/object/sign/kavor-business-documents/${encodedPath}`,{method:'POST',body:{expiresIn:120}});
      const url=data?.signedURL||data?.signedUrl;if(!url)throw new Error('Ingen säker dokumentlänk skapades.');
      window.open(url.startsWith('http')?url:`${config.supabaseUrl}${url}`,'_blank','noopener');
    }catch(error){showMessage(errorText(error),'error')}
  }
  function printOrder(id){
    const order=state.orders.find(item=>item.id===id),company=companyById(order?.company_id);if(!order||!company)return;
    const subtotal=orderTotal(order),vat=subtotal*.25,total=subtotal+vat;
    const win=window.open('','_blank');if(!win){showMessage('Tillåt popup-fönster för att skapa underlaget.','error');return}
    win.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Fakturaunderlag – ${escapeHtml(company.name)}</title><style>body{font:15px/1.5 Arial,sans-serif;color:#172027;max-width:850px;margin:50px auto;padding:0 30px}h1{font-size:34px}header{display:flex;justify-content:space-between;border-bottom:3px solid #c99b4d;margin-bottom:32px}.muted{color:#667}.box{border:1px solid #ccd2d6;border-radius:10px;padding:18px;margin:20px 0}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}.totals{margin-left:auto;width:330px}.totals div{display:flex;justify-content:space-between;padding:7px}.totals .grand{font-weight:bold;font-size:18px;border-top:2px solid #172027}footer{margin-top:70px;border-top:1px solid #ddd;padding-top:12px;color:#667}@media print{button{display:none}body{margin:0}}</style></head><body><header><div><h1>Fakturaunderlag</h1><p class="muted">Skapas som faktura och bokförs i Fortnox</p></div><div><strong>Kavor</strong><br>info@kavor.se<br>kavor.se</div></header><section class="box"><strong>${escapeHtml(company.name)}</strong><br>${escapeHtml(company.org_number||'')}<br>${escapeHtml(company.billing_address||'')}<br>${escapeHtml([company.postal_code,company.city].filter(Boolean).join(' '))}<br>${escapeHtml(company.billing_email||company.email||'')}</section><table><thead><tr><th>Beskrivning</th><th>Antal</th><th>À-pris</th><th>Summa</th></tr></thead><tbody><tr><td>Kavor företagslicens, ${order.package_months} månader</td><td>${order.quantity}</td><td>${formatMoney(order.unit_price_sek)}</td><td>${formatMoney(subtotal)}</td></tr></tbody></table><div class="totals"><div><span>Exkl. moms</span><span>${formatMoney(subtotal)}</span></div><div><span>Moms 25 %</span><span>${formatMoney(vat)}</span></div><div class="grand"><span>Att fakturera</span><span>${formatMoney(total)}</span></div></div><section class="box"><strong>Kontakt/referens</strong><br>${escapeHtml(company.contact_name||'–')}<br><br><strong>Anteckning</strong><br>${escapeHtml(order.notes||'–')}</section><button onclick="window.print()">Skriv ut / Spara som PDF</button><footer>Internt underlag – inte en färdig faktura. Fakturan skapas och skickas från Fortnox.</footer></body></html>`);
    win.document.close();
  }

  function bindEvents(){
    $('#loginForm').addEventListener('submit',async event=>{
      event.preventDefault();const message=$('#loginMessage');message.textContent='Loggar in…';message.className='form-message';
      try{const {data,error}=await client.auth.signInWithPassword({email:$('#loginEmail').value.trim(),password:$('#loginPassword').value});if(error)throw error;state.session=data.session;$('#signedInAs').textContent=state.session.user?.email||'';$('#signOutButton').hidden=false;message.textContent='';await enterAdmin()}catch(error){message.textContent=errorText(error);message.className='form-message error'}
    });
    $('#signOutButton').addEventListener('click',async()=>{await client.auth.signOut();state.session=null;showLogin()});
    $('#retryAdminButton').addEventListener('click',enterAdmin);
    $('#copyUserId').addEventListener('click',async()=>{await navigator.clipboard.writeText($('#currentUserId').textContent);$('#setupMessage').textContent='Användar-id kopierat.'});
    $$('.nav-button').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
    $$('[data-go-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.goView)));
    ['#newCompanyButton','#newCompanyButton2'].forEach(selector=>$(selector).addEventListener('click',()=>openCompany()));
    ['#newOrderButton','#newOrderButton2'].forEach(selector=>$(selector).addEventListener('click',()=>openOrder()));
    ['#newTaskButton','#newTaskButton2'].forEach(selector=>$(selector).addEventListener('click',openTask));
    $('#uploadDocumentButton').addEventListener('click',()=>{if(!state.companies.length){showMessage('Lägg till ett företag först.','error');return}$('#documentForm').reset();fillCompanySelects();$('#documentDialog').showModal()});
    $('#companyForm').addEventListener('submit',saveCompany);$('#orderForm').addEventListener('submit',saveOrder);$('#taskForm').addEventListener('submit',saveTask);$('#documentForm').addEventListener('submit',uploadDocument);
    $('#orderQuantity').addEventListener('input',updateOrderTotal);$('#orderUnitPrice').addEventListener('input',updateOrderTotal);$('#orderDiscount').addEventListener('input',updateOrderTotal);
    $('#companySearch').addEventListener('input',renderCompanies);
    $$('.filter').forEach(button=>button.addEventListener('click',()=>{state.taskFilter=button.dataset.taskFilter;$$('.filter').forEach(item=>item.classList.toggle('active',item===button));renderTasks()}));
    document.addEventListener('click',event=>{
      const close=event.target.closest('[value="cancel"]');if(close){event.preventDefault();close.closest('dialog')?.close();return}
      const editCompany=event.target.closest('[data-edit-company]');if(editCompany){openCompany(companyById(editCompany.dataset.editCompany));return}
      const editOrder=event.target.closest('[data-edit-order]');if(editOrder){openOrder(state.orders.find(order=>order.id===editOrder.dataset.editOrder));return}
      const complete=event.target.closest('[data-complete-task]');if(complete){toggleTask(complete.dataset.completeTask);return}
      const documentButton=event.target.closest('[data-open-document]');if(documentButton){openDocument(documentButton.dataset.openDocument);return}
      const printButton=event.target.closest('[data-print-order]');if(printButton){printOrder(printButton.dataset.printOrder)}
    });
  }

  initialize().catch(error=>{$('#loginMessage').textContent=errorText(error);$('#loginMessage').className='form-message error';showLogin()});
})();

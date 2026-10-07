(function(){
  'use strict';

  const config=window.KAVOR_ACCOUNT_CONFIG||{};
  const translations={
    en:{
      'Kavor-konto':'Kavor account','Företagslicens':'Business licence','Skapa konto':'Create account','Logga in':'Sign in','Logga ut':'Sign out',
      'E-post':'Email','Lösenord':'Password','Minst 8 tecken':'At least 8 characters','Glömt lösenordet?':'Forgot your password?',
      'Skicka återställningslänk':'Send reset link','Nytt lösenord':'New password','Spara nytt lösenord':'Save new password',
      'Har du redan ett konto?':'Already have an account?','Behöver du skapa ett konto?':'Need to create an account?',
      'Ditt konto':'Your account','Kontostatus':'Account status','Ingen aktiv företagslicens':'No active business licence',
      'Aktiv till':'Active until','Aktivera licens':'Activate licence','Aktiveringskod':'Activation code','Aktivera koden':'Activate code',
      'Koden finns på kortet eller i meddelandet från företaget som gav dig Kavor.':'The code is on the card or in the message from the company that gave you Kavor.',
      'Skapa eller logga in på ditt Kavor-konto och lös sedan in företagets kod.':'Create or sign in to your Kavor account, then redeem the company code.',
      'Samma konto fungerar på både iPhone och Android. Ingen betalning eller automatisk förnyelse startas.':'The same account works on both iPhone and Android. No payment or automatic renewal is started.',
      'Konto och aktivering':'Account and activation','Hantera ditt Kavor-konto och kontrollera din företagslicens.':'Manage your Kavor account and check your business licence.',
      'Gå till aktivering':'Go to activation','Till Kavor.se':'Go to Kavor.se','Integritetspolicy':'Privacy policy',
      'Du är inloggad som':'You are signed in as','Skapa kontot':'Create account','Logga in på kontot':'Sign in to account',
      'Kontrollera din e-post och bekräfta kontot innan du loggar in.':'Check your email and confirm the account before signing in.',
      'Kontot har skapats och du är inloggad.':'Your account has been created and you are signed in.',
      'Du är nu inloggad.':'You are now signed in.','Du är nu utloggad.':'You are now signed out.',
      'Återställningslänken har skickats om adressen finns registrerad.':'A reset link has been sent if the address is registered.',
      'Lösenordet har uppdaterats.':'Your password has been updated.','Licensen är aktiverad.':'The licence has been activated.',
      'Koden är ogiltig, redan använd eller har gått ut.':'The code is invalid, already used or expired.',
      'För många försök. Vänta en stund och försök igen.':'Too many attempts. Wait a while and try again.',
      'Tjänsten är inte färdigkonfigurerad ännu.':'The service has not been configured yet.',
      'Något gick fel. Försök igen.':'Something went wrong. Please try again.',
      'E-postadressen eller lösenordet är fel.':'The email address or password is incorrect.',
      'Kavor lagrar bara de kontouppgifter som behövs för att hantera licensen.':'Kavor stores only the account information needed to manage the licence.'
    },
    es:{
      'Kavor-konto':'Cuenta Kavor','Företagslicens':'Licencia empresarial','Skapa konto':'Crear cuenta','Logga in':'Iniciar sesión','Logga ut':'Cerrar sesión',
      'E-post':'Correo electrónico','Lösenord':'Contraseña','Minst 8 tecken':'Mínimo 8 caracteres','Glömt lösenordet?':'¿Has olvidado la contraseña?',
      'Skicka återställningslänk':'Enviar enlace de recuperación','Nytt lösenord':'Nueva contraseña','Spara nytt lösenord':'Guardar nueva contraseña',
      'Har du redan ett konto?':'¿Ya tienes una cuenta?','Behöver du skapa ett konto?':'¿Necesitas crear una cuenta?',
      'Ditt konto':'Tu cuenta','Kontostatus':'Estado de la cuenta','Ingen aktiv företagslicens':'No hay una licencia empresarial activa',
      'Aktiv till':'Activa hasta','Aktivera licens':'Activar licencia','Aktiveringskod':'Código de activación','Aktivera koden':'Activar el código',
      'Koden finns på kortet eller i meddelandet från företaget som gav dig Kavor.':'El código está en la tarjeta o en el mensaje de la empresa que te proporcionó Kavor.',
      'Skapa eller logga in på ditt Kavor-konto och lös sedan in företagets kod.':'Crea o inicia sesión en tu cuenta Kavor y canjea el código de la empresa.',
      'Samma konto fungerar på både iPhone och Android. Ingen betalning eller automatisk förnyelse startas.':'La misma cuenta funciona en iPhone y Android. No se inicia ningún pago ni renovación automática.',
      'Konto och aktivering':'Cuenta y activación','Hantera ditt Kavor-konto och kontrollera din företagslicens.':'Gestiona tu cuenta Kavor y comprueba tu licencia empresarial.',
      'Gå till aktivering':'Ir a activación','Till Kavor.se':'Ir a Kavor.se','Integritetspolicy':'Política de privacidad',
      'Du är inloggad som':'Has iniciado sesión como','Skapa kontot':'Crear la cuenta','Logga in på kontot':'Iniciar sesión en la cuenta',
      'Kontrollera din e-post och bekräfta kontot innan du loggar in.':'Comprueba tu correo y confirma la cuenta antes de iniciar sesión.',
      'Kontot har skapats och du är inloggad.':'La cuenta se ha creado y has iniciado sesión.',
      'Du är nu inloggad.':'Has iniciado sesión.','Du är nu utloggad.':'Has cerrado sesión.',
      'Återställningslänken har skickats om adressen finns registrerad.':'Se ha enviado un enlace de recuperación si la dirección está registrada.',
      'Lösenordet har uppdaterats.':'La contraseña se ha actualizado.','Licensen är aktiverad.':'La licencia ha sido activada.',
      'Koden är ogiltig, redan använd eller har gått ut.':'El código no es válido, ya se ha utilizado o ha caducado.',
      'För många försök. Vänta en stund och försök igen.':'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
      'Tjänsten är inte färdigkonfigurerad ännu.':'El servicio aún no está configurado.',
      'Något gick fel. Försök igen.':'Algo ha fallado. Inténtalo de nuevo.',
      'E-postadressen eller lösenordet är fel.':'El correo electrónico o la contraseña son incorrectos.',
      'Kavor lagrar bara de kontouppgifter som behövs för att hantera licensen.':'Kavor solo almacena los datos de cuenta necesarios para gestionar la licencia.'
    }
  };
  let language=localStorage.getItem('kavorAccountLanguage')||'sv';
  const pendingCodeKey='kavorPendingActivationCode.v1';
  let client=null;

  const byId=id=>document.getElementById(id);
  const translate=text=>translations[language]?.[text]||text;
  const configured=()=>/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl||'')&&!/REPLACE/i.test(config.publishableKey||'');
  const setMessage=(id,text,type='')=>{const node=byId(id);if(!node)return;node.textContent=translate(text);node.className='form-message'+(type?' '+type:'')};
  const setBusy=(form,busy)=>{form?.querySelectorAll('button,input').forEach(node=>node.disabled=busy)};
  const formatDate=value=>new Intl.DateTimeFormat(language==='sv'?'sv-SE':language==='es'?'es-ES':'en-GB',{dateStyle:'long'}).format(new Date(value));

  function applyLanguage(next){
    language=['sv','en','es'].includes(next)?next:'sv';
    localStorage.setItem('kavorAccountLanguage',language);
    document.documentElement.lang=language;
    document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=translate(node.dataset.i18n)});
    document.querySelectorAll('[data-i18n-placeholder]').forEach(node=>{node.placeholder=translate(node.dataset.i18nPlaceholder)});
    if(byId('languageSelect'))byId('languageSelect').value=language;
  }

  async function loadEntitlement(){
    const card=byId('entitlementStatus');
    if(!card||!client)return;
    card.className='status-box';
    card.innerHTML=`<strong>${translate('Kontostatus')}</strong><span class="muted">…</span>`;
    const now=new Date().toISOString();
    const {data,error}=await client.from('entitlements').select('status,valid_from,valid_until,source').eq('status','active').gt('valid_until',now).order('valid_until',{ascending:false}).limit(1).maybeSingle();
    if(error){card.classList.add('error');card.innerHTML=`<strong>${translate('Kontostatus')}</strong><span>${translate('Något gick fel. Försök igen.')}</span>`;return}
    if(!data){card.innerHTML=`<strong>${translate('Ingen aktiv företagslicens')}</strong><span class="muted">${translate('Aktivera licens')}</span>`;return}
    card.classList.add('active');
    card.innerHTML=`<strong>${translate('Företagslicens')}</strong><span>${translate('Aktiv till')}: ${formatDate(data.valid_until)}</span>`;
  }

  async function renderSession(session){
    const loggedOut=byId('loggedOut'),loggedIn=byId('loggedIn'),activation=byId('activationSection');
    if(loggedOut)loggedOut.hidden=!!session;
    if(loggedIn)loggedIn.hidden=!session;
    if(activation)activation.hidden=!session;
    if(byId('signedInEmail'))byId('signedInEmail').textContent=session?.user?.email||'';
    if(session)await loadEntitlement();
  }

  function friendlyError(error){
    const message=(error?.message||'').toLowerCase();
    if(message.includes('invalid login'))return 'E-postadressen eller lösenordet är fel.';
    return 'Något gick fel. Försök igen.';
  }

  async function init(){
    applyLanguage(language);
    byId('languageSelect')?.addEventListener('change',event=>{applyLanguage(event.target.value);loadEntitlement()});
    const hashParams=new URLSearchParams(location.hash.replace(/^#/,''));
    const linkedCode=hashParams.get('code');
    if(linkedCode){
      localStorage.setItem(pendingCodeKey,linkedCode);
      history.replaceState(null,'',location.pathname+location.search);
    }
    const codeInput=document.querySelector('#activationForm [name="code"]');
    if(codeInput)codeInput.value=linkedCode||localStorage.getItem(pendingCodeKey)||'';
    if(new URLSearchParams(location.search).get('mode')==='recovery'&&byId('passwordRecovery'))byId('passwordRecovery').hidden=false;
    if(!configured()||!window.supabase?.createClient){
      byId('configurationNotice').hidden=false;
      document.querySelectorAll('form button').forEach(button=>button.disabled=true);
      return;
    }
    client=window.supabase.createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data:{session}}=await client.auth.getSession();
    await renderSession(session);
    client.auth.onAuthStateChange(async(event,nextSession)=>{
      await renderSession(nextSession);
      if(event==='PASSWORD_RECOVERY'&&byId('passwordRecovery'))byId('passwordRecovery').hidden=false;
    });

    byId('showRegister')?.addEventListener('click',()=>{byId('loginPanel').hidden=true;byId('registerPanel').hidden=false});
    byId('showLogin')?.addEventListener('click',()=>{byId('registerPanel').hidden=true;byId('loginPanel').hidden=false});
    byId('showRecovery')?.addEventListener('click',()=>{byId('loginPanel').hidden=true;byId('recoveryPanel').hidden=false});
    byId('cancelRecovery')?.addEventListener('click',()=>{byId('recoveryPanel').hidden=true;byId('loginPanel').hidden=false});

    byId('loginForm')?.addEventListener('submit',async event=>{
      event.preventDefault();setBusy(event.currentTarget,true);setMessage('authMessage','');
      const values=new FormData(event.currentTarget);
      const {error}=await client.auth.signInWithPassword({email:String(values.get('email')).trim(),password:String(values.get('password'))});
      setBusy(event.currentTarget,false);setMessage('authMessage',error?friendlyError(error):'Du är nu inloggad.',error?'error':'success');
    });
    byId('registerForm')?.addEventListener('submit',async event=>{
      event.preventDefault();setBusy(event.currentTarget,true);setMessage('registerMessage','');
      const values=new FormData(event.currentTarget),email=String(values.get('email')).trim(),password=String(values.get('password'));
      const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:`${config.siteUrl}/activate.html`}});
      setBusy(event.currentTarget,false);
      if(error){setMessage('registerMessage',friendlyError(error),'error');return}
      setMessage('registerMessage',data.session?'Kontot har skapats och du är inloggad.':'Kontrollera din e-post och bekräfta kontot innan du loggar in.','success');
    });
    byId('recoveryForm')?.addEventListener('submit',async event=>{
      event.preventDefault();setBusy(event.currentTarget,true);
      const values=new FormData(event.currentTarget);
      await client.auth.resetPasswordForEmail(String(values.get('email')).trim(),{redirectTo:`${config.siteUrl}/account.html?mode=recovery`});
      setBusy(event.currentTarget,false);setMessage('recoveryMessage','Återställningslänken har skickats om adressen finns registrerad.','success');
    });
    byId('newPasswordForm')?.addEventListener('submit',async event=>{
      event.preventDefault();setBusy(event.currentTarget,true);
      const values=new FormData(event.currentTarget),{error}=await client.auth.updateUser({password:String(values.get('password'))});
      setBusy(event.currentTarget,false);setMessage('newPasswordMessage',error?friendlyError(error):'Lösenordet har uppdaterats.',error?'error':'success');
    });
    byId('signOut')?.addEventListener('click',async()=>{await client.auth.signOut();setMessage('authMessage','Du är nu utloggad.','success')});
    byId('activationForm')?.addEventListener('submit',async event=>{
      event.preventDefault();setBusy(event.currentTarget,true);setMessage('activationMessage','');
      const code=String(new FormData(event.currentTarget).get('code')).trim();
      const {data,error}=await client.rpc('redeem_activation_code',{p_code:code});
      setBusy(event.currentTarget,false);
      if(error){setMessage('activationMessage',friendlyError(error),'error');return}
      const result=Array.isArray(data)?data[0]:data;
      if(result?.result==='activated'||result?.result==='already_redeemed'){
        localStorage.removeItem(pendingCodeKey);setMessage('activationMessage','Licensen är aktiverad.','success');event.currentTarget.reset();await loadEntitlement();return;
      }
      setMessage('activationMessage',result?.result==='rate_limited'?'För många försök. Vänta en stund och försök igen.':'Koden är ogiltig, redan använd eller har gått ut.','error');
    });
  }

  document.addEventListener('DOMContentLoaded',init);
})();

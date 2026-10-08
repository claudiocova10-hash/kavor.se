const CACHE='kavora-shell-v10';
const SHELL=['/admin.html','/admin.css','/admin.js?v=10','/account-config.js','/kavora.webmanifest','/assets/logo-kavor-gold.png','/assets/apple-touch-icon.png','/assets/favicon-192.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==location.origin||!SHELL.some(item=>item.split('?')[0]===url.pathname))return;
  event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));return response}).catch(()=>caches.match(request)));
});

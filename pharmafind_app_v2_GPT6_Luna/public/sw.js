self.addEventListener("install",e=>{e.waitUntil(caches.open("pharmafind-demo-v1").then(c=>c.addAll(["/","/manifest.webmanifest","/icon.svg"])));self.skipWaiting()});
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(r=>r||caches.match("/"))))});

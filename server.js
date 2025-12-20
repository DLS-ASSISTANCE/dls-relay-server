const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => { res.writeHead(200); res.end('OK'); });
const wss = new WebSocket.Server({ server });
const hosts = new Map();
const clients = new Map();
const browsers = new Set();

function broadcastHostsList() {
    const list = {}; hosts.forEach((v, k) => list[k] = {online:true});
    const msg = JSON.stringify({type:'hosts-list',hosts:list});
    browsers.forEach(ws => { if(ws.readyState===1) ws.send(msg); });
}

wss.on('connection', ws => {
    let type=null, id=null;
    ws.on('message', data => {
        const msg = JSON.parse(data);
        if(msg.type==='register-client-browser') { type='browser'; browsers.add(ws); const list={}; hosts.forEach((v,k)=>list[k]={online:true}); ws.send(JSON.stringify({type:'hosts-list',hosts:list})); }
        if(msg.type==='register-host') { type='host'; id=msg.hostId; hosts.set(id,{ws,password:msg.password||''}); ws.send(JSON.stringify({type:'registered',hostId:id})); broadcastHostsList(); }
        if(msg.type==='update-password') { const h=hosts.get(id); if(h) h.password=msg.password||''; }
        if(msg.type==='connect-to-host') { type='client'; id='c_'+Date.now(); const h=hosts.get(msg.hostId); if(!h){ws.send(JSON.stringify({type:'host-not-found'}));return;} if(h.password&&h.password!==msg.password){ws.send(JSON.stringify({type:'auth-failed'}));return;} clients.set(id,{ws,hostId:msg.hostId}); ws.send(JSON.stringify({type:'auth-success'})); h.ws.send(JSON.stringify({type:'client-connected'})); }
        if(msg.type==='screen-data'&&type==='host') clients.forEach(c=>{if(c.hostId===id&&c.ws.readyState===1)c.ws.send(data);});
        if(['mouse-click','mouse-dblclick','mouse-rightclick','key-press','scroll'].includes(msg.type)&&type==='client') { const c=clients.get(id); if(c){const h=hosts.get(c.hostId);if(h)h.ws.send(data);} }
    });
    ws.on('close', () => { browsers.delete(ws); if(type==='host'){hosts.delete(id);broadcastHostsList();} if(type==='client')clients.delete(id); });
});
server.listen(PORT);
    });
}, 30000);

server.listen(PORT, () => {
    console.log('DLS Relay Server running on port', PORT);
});

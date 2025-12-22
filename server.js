const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('DLS Relay Server v1.1.0 - OK - Hosts: ' + hosts.size);
});

const wss = new WebSocket.Server({ server });
const hosts = new Map();
const clients = new Map();
const browsers = new Set();

function broadcastHostsList() {
    const hostsList = {};
    hosts.forEach((data, hostId) => {
        hostsList[hostId] = { online: true, name: data.hostName || '' };
    });
    const msg = JSON.stringify({ type: 'hosts-list', hosts: hostsList });
    browsers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(msg); } catch(e) {}
        }
    });
}

wss.on('connection', (ws) => {
    let connectionType = null;
    let connectionId = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            if (msg.type === 'register-client-browser') {
                connectionType = 'browser';
                browsers.add(ws);
                const hostsList = {};
                hosts.forEach((data, hostId) => {
                    hostsList[hostId] = { online: true, name: data.hostName || '' };
                });
                ws.send(JSON.stringify({ type: 'hosts-list', hosts: hostsList }));
            }
            
            if (msg.type === 'register-host') {
                connectionType = 'host';
                connectionId = msg.hostId;
                const oldHost = hosts.get(msg.hostId);
                if (oldHost && oldHost.ws !== ws && oldHost.ws.readyState === WebSocket.OPEN) {
                    oldHost.ws.close();
                }
                hosts.set(msg.hostId, { ws: ws, password: msg.password || '', hostName: msg.hostName || '' });
                ws.send(JSON.stringify({ type: 'registered', hostId: msg.hostId }));
                broadcastHostsList();
                console.log('Host registered:', msg.hostId);
            }
            
            if (msg.type === 'connect-to-host') {
                const host = hosts.get(msg.hostId);
                if (!host) { ws.send(JSON.stringify({ type: 'host-not-found' })); return; }
                if (host.password && host.password !== msg.password) { ws.send(JSON.stringify({ type: 'auth-failed' })); return; }
                connectionType = 'client';
                connectionId = 'c_' + Date.now();
                clients.set(connectionId, { ws: ws, hostId: msg.hostId });
                ws.send(JSON.stringify({ type: 'auth-success' }));
                host.ws.send(JSON.stringify({ type: 'client-connected', clientId: connectionId }));
            }
            
            if (msg.type === 'screen-data' && connectionType === 'host') {
                clients.forEach((client) => {
                    if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                        try { client.ws.send(data); } catch(e) {}
                    }
                });
            }
            
            if (['mouse-click', 'mouse-dblclick', 'mouse-rightclick', 'key-press', 'scroll'].includes(msg.type) && connectionType === 'client') {
                const client = clients.get(connectionId);
                if (client) {
                    const host = hosts.get(client.hostId);
                    if (host && host.ws.readyState === WebSocket.OPEN) {
                        try { host.ws.send(data); } catch(e) {}
                    }
                }
            }
        } catch(e) {}
    });
    
    ws.on('close', () => {
        browsers.delete(ws);
        if (connectionType === 'host' && connectionId) {
            hosts.delete(connectionId);
            broadcastHostsList();
            clients.forEach((client) => {
                if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                    try { client.ws.send(JSON.stringify({ type: 'host-disconnected' })); } catch(e) {}
                }
            });
        }
        if (connectionType === 'client' && connectionId) {
            const client = clients.get(connectionId);
            if (client) {
                const host = hosts.get(client.hostId);
                if (host && host.ws.readyState === WebSocket.OPEN) {
                    try { host.ws.send(JSON.stringify({ type: 'client-disconnected' })); } catch(e) {}
                }
            }
            clients.delete(connectionId);
        }
    });
});

setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.listen(PORT, () => { console.log('DLS Relay Server v1.1.0 on port', PORT); });

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('DLS Relay Server OK - ' + hosts.size + ' hotes connectes');
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const wss = new WebSocket.Server({ server });
const hosts = new Map();
const clients = new Map();

console.log('DLS Relay Server starting...');

wss.on('connection', (ws, req) => {
    let clientType = null;
    let clientId = null;
    
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            if (msg.type === 'register-host') {
                clientType = 'host';
                clientId = msg.hostId;
                const oldHost = hosts.get(msg.hostId);
                if (oldHost && oldHost.ws !== ws) oldHost.ws.close();
                hosts.set(msg.hostId, { ws: ws, password: msg.password || '' });
                ws.send(JSON.stringify({ type: 'registered', hostId: msg.hostId }));
                console.log('Hôte enregistré:', msg.hostId);
            }
            
            if (msg.type === 'update-password' && clientType === 'host') {
                const host = hosts.get(clientId);
                if (host) host.password = msg.password || '';
            }
            
            if (msg.type === 'connect-to-host') {
                clientType = 'client';
                clientId = 'c_' + Date.now();
                const host = hosts.get(msg.hostId);
                if (!host) {
                    ws.send(JSON.stringify({ type: 'host-not-found' }));
                    return;
                }
                if (host.password && host.password !== msg.password) {
                    ws.send(JSON.stringify({ type: 'auth-failed' }));
                    return;
                }
                clients.set(clientId, { ws: ws, hostId: msg.hostId });
                ws.send(JSON.stringify({ type: 'auth-success', clientId: clientId }));
                if (host.ws.readyState === WebSocket.OPEN) {
                    host.ws.send(JSON.stringify({ type: 'client-connected', clientId: clientId }));
                }
            }
            
            if (msg.type === 'screen-data' && clientType === 'host') {
                clients.forEach((client) => {
                    if (client.hostId === clientId && client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(data.toString());
                    }
                });
            }
            
            if (['mouse-click', 'mouse-move', 'key-press', 'key-down', 'key-up', 'scroll'].includes(msg.type) && clientType === 'client') {
                const client = clients.get(clientId);
                if (client) {
                    const host = hosts.get(client.hostId);
                    if (host && host.ws.readyState === WebSocket.OPEN) {
                        host.ws.send(data.toString());
                    }
                }
            }
        } catch(e) {
            console.error('Erreur:', e.message);
        }
    });
    
    ws.on('close', () => {
        if (clientType === 'host' && clientId) {
            hosts.delete(clientId);
            clients.forEach((client, cid) => {
                if (client.hostId === clientId && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(JSON.stringify({ type: 'host-disconnected' }));
                }
            });
        }
        if (clientType === 'client' && clientId) {
            const client = clients.get(clientId);
            if (client) {
                const host = hosts.get(client.hostId);
                if (host && host.ws.readyState === WebSocket.OPEN) {
                    host.ws.send(JSON.stringify({ type: 'client-disconnected', clientId: clientId }));
                }
            }
            clients.delete(clientId);
        }
    });
});

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.listen(PORT, () => {
    console.log('DLS Relay Server running on port', PORT);
});

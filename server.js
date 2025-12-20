bash

cat /home/claude/DLS_RELAY_SERVER/server.js
Sortie

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

// Créer serveur HTTP pour le health check de Render
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('DLS Relay Server OK - ' + hosts.size + ' hotes connectes');
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// WebSocket sur le même serveur HTTP
const wss = new WebSocket.Server({ server });

// Stockage
const hosts = new Map();    // hostId -> { ws, password }
const clients = new Map();  // clientId -> { ws, hostId }

console.log('DLS Relay Server starting...');

wss.on('connection', (ws, req) => {
    let clientType = null;
    let clientId = null;
    
    console.log('Nouvelle connexion depuis:', req.socket.remoteAddress);
    
    // Ping pour garder la connexion active
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            // Enregistrement d'un hôte
            if (msg.type === 'register-host') {
                clientType = 'host';
                clientId = msg.hostId;
                
                // Fermer l'ancienne connexion si existe
                const oldHost = hosts.get(msg.hostId);
                if (oldHost && oldHost.ws !== ws) {
                    oldHost.ws.close();
                }
                
                hosts.set(msg.hostId, { ws: ws, password: msg.password || '' });
                ws.send(JSON.stringify({ type: 'registered', hostId: msg.hostId }));
                console.log('Hôte enregistré:', msg.hostId, '- Total:', hosts.size);
            }
            
            // Mise à jour mot de passe
            if (msg.type === 'update-password' && clientType === 'host') {
                const host = hosts.get(clientId);
                if (host) {
                    host.password = msg.password || '';
                    console.log('Password mis à jour pour:', clientId);
                }
            }
            
            // Connexion client vers hôte
            if (msg.type === 'connect-to-host') {
                clientType = 'client';
                clientId = 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                
                const host = hosts.get(msg.hostId);
                if (!host) {
                    ws.send(JSON.stringify({ type: 'host-not-found' }));
                    console.log('Hôte non trouvé:', msg.hostId);
                    return;
                }
                
                // Vérifier mot de passe
                if (host.password && host.password !== msg.password) {
                    ws.send(JSON.stringify({ type: 'auth-failed' }));
                    console.log('Auth échouée pour:', msg.hostId);
                    return;
                }
                
                // Succès
                clients.set(clientId, { ws: ws, hostId: msg.hostId });
                ws.send(JSON.stringify({ type: 'auth-success', clientId: clientId }));
                
                // Notifier l'hôte
                if (host.ws.readyState === WebSocket.OPEN) {
                    host.ws.send(JSON.stringify({ 
                        type: 'client-connected',
                        clientId: clientId 
                    }));
                }
                console.log('Client', clientId, 'connecté à', msg.hostId);
            }
            
            // Relayer données écran hôte -> client
            if (msg.type === 'screen-data' && clientType === 'host') {
                clients.forEach((client) => {
                    if (client.hostId === clientId && client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(data.toString());
                    }
                });
            }
            
            // Relayer événements client -> hôte
            if (['mouse-click', 'mouse-move', 'mouse-down', 'mouse-up', 'key-press', 'key-down', 'key-up', 'scroll'].includes(msg.type) && clientType === 'client') {
                const client = clients.get(clientId);
                if (client) {
                    const host = hosts.get(client.hostId);
                    if (host && host.ws.readyState === WebSocket.OPEN) {
                        host.ws.send(data.toString());
                    }
                }
            }
            
        } catch(e) {
            console.error('Erreur message:', e.message);
        }
    });
    
    ws.on('close', () => {
        if (clientType === 'host' && clientId) {
            hosts.delete(clientId);
            console.log('Hôte déconnecté:', clientId, '- Restant:', hosts.size);
            
            // Notifier les clients
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
                    host.ws.send(JSON.stringify({ 
                        type: 'client-disconnected',
                        clientId: clientId 
                    }));
                }
            }
            clients.delete(clientId);
            console.log('Client déconnecté:', clientId);
        }
    });
    
    ws.on('error', (err) => {
        console.error('Erreur WS:', err.message);
    });
});

// Ping toutes les 30 secondes pour garder les connexions actives
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

server.listen(PORT, () => {
    console.log('DLS Relay Server running on port', PORT);
});

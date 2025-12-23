// DLS ASSISTANCE WEB 2026 - Serveur Relais
// Version 1.1.2
// Hébergé sur Render.com

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

// Créer serveur HTTP pour health check
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('DLS Relay Server v1.1.2 - OK - Hosts: ' + hosts.size);
});

const wss = new WebSocket.Server({ server });

// Stockage des connexions
const hosts = new Map();      // hostId -> { ws, password, hostName, thumbnail }
const clients = new Map();    // clientId -> { ws, hostId }
const browsers = new Set();   // clients qui veulent la liste des hôtes

console.log('DLS Relay Server v1.1.2 starting...');

// Diffuser la liste des hôtes à tous les browsers
function broadcastHostsList() {
    const hostsList = {};
    hosts.forEach((data, hostId) => {
        hostsList[hostId] = { 
            online: true, 
            name: data.hostName || '',
            thumbnail: data.thumbnail || null
        };
    });
    
    const msg = JSON.stringify({ type: 'hosts-list', hosts: hostsList });
    browsers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(msg); } catch(e) {}
        }
    });
}

// Ping pour garder les connexions actives
const pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(pingInterval);
});

wss.on('connection', (ws) => {
    let connectionType = null;
    let connectionId = null;
    
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            // Ping keepalive - répondre immédiatement
            if (msg.type === 'ping') {
                ws.isAlive = true;
                return;
            }
            
            // Client browser veut la liste des hôtes
            if (msg.type === 'register-client-browser') {
                connectionType = 'browser';
                browsers.add(ws);
                
                // Envoyer la liste actuelle avec thumbnails
                const hostsList = {};
                hosts.forEach((data, hostId) => {
                    hostsList[hostId] = { 
                        online: true, 
                        name: data.hostName || '',
                        thumbnail: data.thumbnail || null
                    };
                });
                ws.send(JSON.stringify({ type: 'hosts-list', hosts: hostsList }));
                console.log('Browser registered - Total browsers:', browsers.size);
            }
            
            // Enregistrement d'un hôte
            if (msg.type === 'register-host') {
                connectionType = 'host';
                connectionId = msg.hostId;
                
                // Fermer l'ancienne connexion si existe
                const oldHost = hosts.get(msg.hostId);
                if (oldHost && oldHost.ws !== ws && oldHost.ws.readyState === WebSocket.OPEN) {
                    oldHost.ws.close();
                }
                
                hosts.set(msg.hostId, { 
                    ws: ws, 
                    password: msg.password || '',
                    hostName: msg.hostName || '',
                    thumbnail: null
                });
                
                ws.send(JSON.stringify({ type: 'registered', hostId: msg.hostId }));
                broadcastHostsList();
                console.log('Host registered:', msg.hostId, '- Name:', msg.hostName || '(none)');
            }
            
            // Client veut se connecter à un hôte
            if (msg.type === 'connect-to-host') {
                const host = hosts.get(msg.hostId);
                
                if (!host) {
                    ws.send(JSON.stringify({ type: 'host-not-found' }));
                    console.log('Host not found:', msg.hostId);
                    return;
                }
                
                if (host.password && host.password !== msg.password) {
                    ws.send(JSON.stringify({ type: 'auth-failed' }));
                    console.log('Auth failed for host:', msg.hostId);
                    return;
                }
                
                connectionType = 'client';
                connectionId = 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                
                clients.set(connectionId, { ws: ws, hostId: msg.hostId });
                
                // Envoyer auth-success avec le nom de l'hôte
                ws.send(JSON.stringify({ 
                    type: 'auth-success',
                    hostName: host.hostName || ''
                }));
                host.ws.send(JSON.stringify({ type: 'client-connected', clientId: connectionId }));
                
                console.log('Client', connectionId, 'connected to host:', msg.hostId);
            }
            
            // Données d'écran (host -> clients)
            if (msg.type === 'screen-data' && connectionType === 'host') {
                clients.forEach((client, clientId) => {
                    if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                        try { client.ws.send(data); } catch(e) {}
                    }
                });
            }
            
            // Liste des moniteurs
            if (msg.type === 'monitors-list' && connectionType === 'host') {
                clients.forEach((client, clientId) => {
                    if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                        try { client.ws.send(data); } catch(e) {}
                    }
                });
            }
            
            // Thumbnail de l'hôte
            if (msg.type === 'host-thumbnail' && connectionType === 'host') {
                const host = hosts.get(connectionId);
                if (host) {
                    host.thumbnail = msg.thumbnail;
                    broadcastHostsList();
                }
            }
            
            // Actions du client vers l'hôte
            if (['mouse-click', 'mouse-dblclick', 'mouse-rightclick', 'key-press', 'scroll', 'change-monitor'].includes(msg.type)) {
                if (connectionType === 'client') {
                    const client = clients.get(connectionId);
                    if (client) {
                        const host = hosts.get(client.hostId);
                        if (host && host.ws.readyState === WebSocket.OPEN) {
                            try { host.ws.send(data); } catch(e) {}
                        }
                    }
                }
            }
            
            // Messages de chat
            if (msg.type === 'chat-message') {
                if (connectionType === 'host') {
                    // Host -> tous ses clients
                    clients.forEach((client, clientId) => {
                        if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                            try { client.ws.send(data); } catch(e) {}
                        }
                    });
                } else if (connectionType === 'client') {
                    // Client -> son host
                    const client = clients.get(connectionId);
                    if (client) {
                        const host = hosts.get(client.hostId);
                        if (host && host.ws.readyState === WebSocket.OPEN) {
                            try { host.ws.send(data); } catch(e) {}
                        }
                    }
                }
            }
            
            // Mise à jour des paramètres hôte
            if (msg.type === 'update-host-settings' && connectionType === 'host') {
                const host = hosts.get(connectionId);
                if (host) {
                    if (msg.hostName !== undefined) host.hostName = msg.hostName;
                    if (msg.password !== undefined) host.password = msg.password;
                    broadcastHostsList();
                    console.log('Host settings updated:', connectionId);
                }
            }
            
        } catch (e) {
            console.error('Error processing message:', e.message);
        }
    });
    
    ws.on('close', () => {
        if (connectionType === 'host') {
            hosts.delete(connectionId);
            broadcastHostsList();
            
            // Notifier les clients connectés
            clients.forEach((client, clientId) => {
                if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                    try {
                        client.ws.send(JSON.stringify({ type: 'host-disconnected' }));
                    } catch(e) {}
                }
            });
            console.log('Host disconnected:', connectionId);
            
        } else if (connectionType === 'client') {
            const client = clients.get(connectionId);
            if (client) {
                const host = hosts.get(client.hostId);
                if (host && host.ws.readyState === WebSocket.OPEN) {
                    try {
                        host.ws.send(JSON.stringify({ type: 'client-disconnected', clientId: connectionId }));
                    } catch(e) {}
                }
            }
            clients.delete(connectionId);
            console.log('Client disconnected:', connectionId);
            
        } else if (connectionType === 'browser') {
            browsers.delete(ws);
            console.log('Browser disconnected - Remaining:', browsers.size);
        }
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
});

server.listen(PORT, () => {
    console.log(`DLS Relay Server v1.1.2 running on port ${PORT}`);
});

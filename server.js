// DLS ASSISTANCE WEB - Serveur Relais
// Version 1.1.0 - Code stable et fiable
// Hébergé sur Render.com

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

// Créer serveur HTTP pour health check
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('DLS Relay Server v1.1.0 - OK - Hosts: ' + hosts.size);
});

const wss = new WebSocket.Server({ server });

// Stockage des connexions
const hosts = new Map();      // hostId -> { ws, password, hostName }
const clients = new Map();    // clientId -> { ws, hostId }
const browsers = new Set();   // clients qui veulent la liste des hôtes

console.log('DLS Relay Server v1.1.0 starting...');

// Diffuser la liste des hôtes à tous les browsers
function broadcastHostsList() {
    const hostsList = {};
    hosts.forEach((data, hostId) => {
        hostsList[hostId] = { 
            online: true, 
            name: data.hostName || '' 
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
    let connectionType = null;  // 'host', 'client', 'browser'
    let connectionId = null;
    
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            // Client browser veut la liste des hôtes
            if (msg.type === 'register-client-browser') {
                connectionType = 'browser';
                browsers.add(ws);
                
                // Envoyer la liste actuelle
                const hostsList = {};
                hosts.forEach((data, hostId) => {
                    hostsList[hostId] = { online: true, name: data.hostName || '' };
                });
                ws.send(JSON.stringify({ type: 'hosts-list', hosts: hostsList }));
                console.log('Browser registered - Total browsers:', browsers.size);
            }
            
            // Enregistrement d'un hôte
            if (msg.type === 'register-host') {
                connectionType = 'host';
                connectionId = msg.hostId;
                
                // Fermer l'ancienne connexion si elle existe
                const oldHost = hosts.get(msg.hostId);
                if (oldHost && oldHost.ws !== ws && oldHost.ws.readyState === WebSocket.OPEN) {
                    oldHost.ws.close();
                }
                
                hosts.set(msg.hostId, { 
                    ws: ws, 
                    password: msg.password || '',
                    hostName: msg.hostName || ''
                });
                
                ws.send(JSON.stringify({ type: 'registered', hostId: msg.hostId }));
                broadcastHostsList();
                console.log('Host registered:', msg.hostId, '- Name:', msg.hostName || '(none)', '- Total hosts:', hosts.size);
            }
            
            // Mise à jour du mot de passe
            if (msg.type === 'update-password' && connectionType === 'host') {
                const host = hosts.get(connectionId);
                if (host) {
                    host.password = msg.password || '';
                    console.log('Password updated for host:', connectionId);
                }
            }
            
            // Client veut se connecter à un hôte
            if (msg.type === 'connect-to-host') {
                const host = hosts.get(msg.hostId);
                
                if (!host) {
                    ws.send(JSON.stringify({ type: 'host-not-found' }));
                    console.log('Connection failed - Host not found:', msg.hostId);
                    return;
                }
                
                if (host.password && host.password !== msg.password) {
                    ws.send(JSON.stringify({ type: 'auth-failed' }));
                    console.log('Connection failed - Wrong password for host:', msg.hostId);
                    return;
                }
                
                connectionType = 'client';
                connectionId = 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                
                clients.set(connectionId, { ws: ws, hostId: msg.hostId });
                
                ws.send(JSON.stringify({ type: 'auth-success' }));
                host.ws.send(JSON.stringify({ type: 'client-connected', clientId: connectionId }));
                
                console.log('Client', connectionId, 'connected to host:', msg.hostId);
            }
            
            // Données d'écran de l'hôte vers les clients
            if (msg.type === 'screen-data' && connectionType === 'host') {
                clients.forEach((client, clientId) => {
                    if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                        try { client.ws.send(data); } catch(e) {}
                    }
                });
            }
            
            // Actions du client vers l'hôte
            if (['mouse-click', 'mouse-dblclick', 'mouse-rightclick', 'key-press', 'scroll'].includes(msg.type)) {
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
            
            // Commande de modification des paramètres hôte (depuis un client connecté)
            if (msg.type === 'update-host-settings' && connectionType === 'client') {
                const client = clients.get(connectionId);
                if (client) {
                    const host = hosts.get(client.hostId);
                    if (host && host.ws.readyState === WebSocket.OPEN) {
                        // Relayer la commande à l'hôte
                        try { 
                            host.ws.send(JSON.stringify({
                                type: 'update-settings-request',
                                setting: msg.setting,  // 'name' ou 'password'
                                value: msg.value
                            }));
                            console.log('Settings update relayed to host:', client.hostId, '-', msg.setting);
                        } catch(e) {}
                    }
                }
            }
            
            // Messages de chat client -> hôte
            if (msg.type === 'chat-message' && connectionType === 'client') {
                const client = clients.get(connectionId);
                if (client) {
                    const host = hosts.get(client.hostId);
                    if (host && host.ws.readyState === WebSocket.OPEN) {
                        try { 
                            host.ws.send(JSON.stringify({
                                type: 'chat-message',
                                from: 'client',
                                message: msg.message
                            }));
                            console.log('Chat message relayed to host:', client.hostId);
                        } catch(e) {}
                    }
                }
            }
            
            // Messages de chat hôte -> clients
            if (msg.type === 'chat-message' && connectionType === 'host') {
                clients.forEach((client, clientId) => {
                    if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                        try {
                            client.ws.send(JSON.stringify({
                                type: 'chat-message',
                                from: 'host',
                                message: msg.message
                            }));
                        } catch(e) {}
                    }
                });
                console.log('Chat message sent from host:', connectionId);
            }
            
        } catch(e) {
            console.error('Error processing message:', e.message);
        }
    });
    
    ws.on('close', () => {
        browsers.delete(ws);
        
        if (connectionType === 'host' && connectionId) {
            hosts.delete(connectionId);
            broadcastHostsList();
            
            // Notifier les clients connectés à cet hôte
            clients.forEach((client, clientId) => {
                if (client.hostId === connectionId && client.ws.readyState === WebSocket.OPEN) {
                    try {
                        client.ws.send(JSON.stringify({ type: 'host-disconnected' }));
                    } catch(e) {}
                }
            });
            
            console.log('Host disconnected:', connectionId, '- Remaining hosts:', hosts.size);
        }
        
        if (connectionType === 'client' && connectionId) {
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
        }
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
});

// Log périodique
setInterval(() => {
    console.log('Status - Hosts:', hosts.size, '| Clients:', clients.size, '| Browsers:', browsers.size);
}, 60000);

server.listen(PORT, () => {
    console.log('DLS Relay Server v1.1.0 running on port', PORT);
});

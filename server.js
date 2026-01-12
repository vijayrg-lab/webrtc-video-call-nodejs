const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MediaSoup client is now bundled and served from public folder via express.static
// The bundle was created using: browserify node_modules/mediasoup-client/lib/index.js -s mediasoupClient -o public/mediasoup-client.min.js

// ============================================================================
// HTTPS Configuration
// ============================================================================

/**
 * Load SSL certificates for HTTPS
 * Supports multiple certificate sources:
 * 1. mkcert certificates (certs/cert.pem, certs/key.pem)
 * 2. Self-signed certificates (certs/cert.pem, certs/key.pem)
 * 3. Let's Encrypt (certs/fullchain.pem, certs/privkey.pem)
 * 4. Environment variables (SSL_CERT_PATH, SSL_KEY_PATH)
 */
function loadSSLCertificates() {
  const certPaths = [
    // Option 1: mkcert or self-signed (recommended for local dev)
    {
      cert: path.join(__dirname, 'certs', 'cert.pem'),
      key: path.join(__dirname, 'certs', 'key.pem')
    },
    // Option 2: Let's Encrypt style
    {
      cert: path.join(__dirname, 'certs', 'fullchain.pem'),
      key: path.join(__dirname, 'certs', 'privkey.pem')
    },
    // Option 3: Environment variables
    {
      cert: process.env.SSL_CERT_PATH,
      key: process.env.SSL_KEY_PATH
    }
  ];

  for (const certPath of certPaths) {
    if (certPath.cert && certPath.key) {
      try {
        if (fs.existsSync(certPath.cert) && fs.existsSync(certPath.key)) {
          console.log(`✓ SSL certificates found: ${certPath.cert}`);
          return {
            cert: fs.readFileSync(certPath.cert, 'utf8'),
            key: fs.readFileSync(certPath.key, 'utf8')
          };
        }
      } catch (error) {
        console.warn(`Failed to load certificate from ${certPath.cert}:`, error.message);
      }
    }
  }

  return null;
}

// Determine if HTTPS should be used
const USE_HTTPS = process.env.USE_HTTPS === 'true' || process.env.USE_HTTPS === '1';
const sslOptions = USE_HTTPS ? loadSSLCertificates() : null;

// Create HTTP or HTTPS server
let server;
if (USE_HTTPS && sslOptions) {
  server = https.createServer(sslOptions, app);
  console.log('✓ HTTPS server enabled');
} else if (USE_HTTPS && !sslOptions) {
  console.warn('⚠️  USE_HTTPS is enabled but no certificates found. Falling back to HTTP.');
  console.warn('   To enable HTTPS:');
  console.warn('   1. Generate certificates (see HTTPS_SETUP_GUIDE.md)');
  console.warn('   2. Place them in certs/ directory');
  console.warn('   3. Set USE_HTTPS=true');
  server = http.createServer(app);
} else {
  server = http.createServer(app);
  console.log('ℹ️  HTTP server (HTTPS required for mobile WebRTC)');
  console.log('   To enable HTTPS, see HTTPS_SETUP_GUIDE.md');
}

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MediaSoup configuration
const mediasoupConfig = {
  numWorkers: 2, // Number of worker processes
  worker: {
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'audio',
        mimeType: 'audio/PCMU',
        clockRate: 8000,
      },
      {
        kind: 'audio',
        mimeType: 'audio/PCMA',
        clockRate: 8000,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1,
        },
      },
    ],
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0', // Listen on all interfaces
        announcedIp: '192.168.1.8', // Set to your local network IP
      },
    ],
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
  },
};

let workers = [];
let rooms = new Map(); // roomId -> { router, peers }

// Initialize MediaSoup workers
async function createWorkers() {
  for (let i = 0; i < mediasoupConfig.numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: mediasoupConfig.worker.logLevel,
      logTags: mediasoupConfig.worker.logTags,
      rtcMinPort: mediasoupConfig.worker.rtcMinPort,
      rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
    });

    worker.on('died', () => {
      console.error('MediaSoup worker died, exiting in 2 seconds...');
      setTimeout(() => process.exit(1), 2000);
    });

    workers.push(worker);
    console.log(`MediaSoup worker ${i} created`);
  }
}

// Get next worker (round-robin)
function getNextWorker() {
  return workers[Math.floor(Math.random() * workers.length)];
}

// Create or get room
async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) {
    return rooms.get(roomId);
  }

  const worker = getNextWorker();
  const router = await worker.createRouter({
    mediaCodecs: mediasoupConfig.router.mediaCodecs,
  });

  const room = {
    router,
    peers: new Map(),
  };

  rooms.set(roomId, room);
  console.log(`Room ${roomId} created`);
  return room;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join-room', async ({ roomId, peerId }, callback) => {
    try {
      if (!callback || typeof callback !== 'function') {
        console.error('join-room: callback is not a function');
        return;
      }

      if (!roomId || !peerId) {
        callback({ error: 'roomId and peerId are required' });
        return;
      }

      const room = await getOrCreateRoom(roomId);
      
      if (room.peers.has(peerId)) {
        callback({ error: 'Peer already exists in room' });
        return;
      }

      // Get router RTP capabilities
      const routerRtpCapabilities = room.router.rtpCapabilities;

      // Create send transport
      const sendTransport = await room.router.createWebRtcTransport({
        listenIps: mediasoupConfig.webRtcTransport.listenIps,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
      });

      await sendTransport.setMaxIncomingBitrate(mediasoupConfig.webRtcTransport.minimumAvailableOutgoingBitrate);

      // Create receive transport
      const recvTransport = await room.router.createWebRtcTransport({
        listenIps: mediasoupConfig.webRtcTransport.listenIps,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
      });

      await recvTransport.setMaxIncomingBitrate(mediasoupConfig.webRtcTransport.minimumAvailableOutgoingBitrate);

      const peer = {
        id: peerId,
        socket,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };

      room.peers.set(peerId, peer);
      peer.transports.set(sendTransport.id, sendTransport);
      peer.transports.set(recvTransport.id, recvTransport);

      socket.join(roomId);

      // Notify other peers about new peer (exclude the current socket)
      try {
        if (io && roomId) {
          socket.to(roomId).emit('peer-joined', { peerId });
        }
      } catch (emitError) {
        console.error('Error emitting peer-joined:', emitError);
      }

      // Send transport parameters to client
      callback({
        sendTransport: {
          id: sendTransport.id,
          iceParameters: sendTransport.iceParameters,
          iceCandidates: sendTransport.iceCandidates,
          dtlsParameters: sendTransport.dtlsParameters,
          sctpParameters: sendTransport.sctpParameters,
        },
        recvTransport: {
          id: recvTransport.id,
          iceParameters: recvTransport.iceParameters,
          iceCandidates: recvTransport.iceCandidates,
          dtlsParameters: recvTransport.dtlsParameters,
          sctpParameters: recvTransport.sctpParameters,
        },
        routerRtpCapabilities,
      });

      // Handle transport events
      sendTransport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          sendTransport.close();
        }
      });

      sendTransport.on('close', () => {
        console.log(`Send transport ${sendTransport.id} closed`);
      });

      recvTransport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          recvTransport.close();
        }
      });

      recvTransport.on('close', () => {
        console.log(`Recv transport ${recvTransport.id} closed`);
      });

      console.log(`Peer ${peerId} joined room ${roomId}`);
    } catch (error) {
      console.error('Error joining room:', error);
      if (callback && typeof callback === 'function') {
        callback({ error: error.message });
      }
    }
  });

  socket.on('connect-transport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      if (!callback || typeof callback !== 'function') {
        console.error('connect-transport: callback is not a function');
        return;
      }

      if (!dtlsParameters) {
        callback({ error: 'dtlsParameters is required' });
        return;
      }

      const peer = getPeerBySocket(socket);
      if (!peer) {
        callback({ error: 'Peer not found' });
        return;
      }

      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }

      console.log(`Connecting transport ${transportId} for peer ${peer.id}`);
      await transport.connect({ dtlsParameters });
      console.log(`Transport ${transportId} connected successfully`);
      callback({ success: true });
    } catch (error) {
      console.error('Error connecting transport:', error);
      callback({ error: error.message || 'Failed to connect transport' });
    }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    try {
      if (!callback || typeof callback !== 'function') {
        console.error('produce: callback is not a function');
        return;
      }

      const peer = getPeerBySocket(socket);
      if (!peer) {
        callback({ error: 'Peer not found' });
        return;
      }

      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }

      const producer = await transport.produce({ kind, rtpParameters });
      peer.producers.set(producer.id, producer);

      // Notify other peers about new producer
      const roomId = getRoomByPeer(peer);
      try {
        if (roomId && socket && io) {
          socket.to(roomId).emit('new-producer', {
            peerId: peer.id,
            producerId: producer.id,
            kind: producer.kind,
          });
        }
      } catch (emitError) {
        console.error('Error emitting new-producer:', emitError);
      }

      callback({ id: producer.id });

      producer.on('transportclose', () => {
        producer.close();
        peer.producers.delete(producer.id);
      });
    } catch (error) {
      console.error('Error producing:', error);
      callback({ error: error.message });
    }
  });

  socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, callback) => {
    try {
      if (!callback || typeof callback !== 'function') {
        console.error('consume: callback is not a function');
        return;
      }

      const peer = getPeerBySocket(socket);
      if (!peer) {
        callback({ error: 'Peer not found' });
        return;
      }

      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }

      const producerPeer = getPeerByProducerId(producerId);
      if (!producerPeer) {
        callback({ error: 'Producer peer not found' });
        return;
      }

      const producer = producerPeer.producers.get(producerId);
      if (!producer) {
        callback({ error: 'Producer not found' });
        return;
      }

      const room = getRoomByPeer(peer);
      if (!room) {
        callback({ error: 'Room not found' });
        return;
      }

      const roomObj = rooms.get(room);
      if (!roomObj) {
        callback({ error: 'Room object not found' });
        return;
      }

      if (!roomObj.router.canConsume({ producerId, rtpCapabilities })) {
        callback({ error: 'Cannot consume' });
        return;
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false,
      });

      peer.consumers.set(consumer.id, consumer);

      callback({
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });

      consumer.on('transportclose', () => {
        consumer.close();
        peer.consumers.delete(consumer.id);
      });
    } catch (error) {
      console.error('Error consuming:', error);
      callback({ error: error.message });
    }
  });

  socket.on('resume-consumer', async ({ consumerId }, callback) => {
    try {
      if (!callback || typeof callback !== 'function') {
        console.error('resume-consumer: callback is not a function');
        return;
      }

      const peer = getPeerBySocket(socket);
      if (!peer) {
        callback({ error: 'Peer not found' });
        return;
      }

      const consumer = peer.consumers.get(consumerId);
      if (!consumer) {
        callback({ error: 'Consumer not found' });
        return;
      }

      await consumer.resume();
      callback({ success: true });
    } catch (error) {
      console.error('Error resuming consumer:', error);
      callback({ error: error.message });
    }
  });

  socket.on('get-producers', async (callback) => {
    try {
      if (!callback || typeof callback !== 'function') {
        console.error('get-producers: callback is not a function');
        return;
      }

      const peer = getPeerBySocket(socket);
      if (!peer) {
        callback({ error: 'Peer not found' });
        return;
      }

      const room = getRoomByPeer(peer);
      if (!room) {
        callback({ error: 'Room not found' });
        return;
      }

      const roomObj = rooms.get(room);
      if (!roomObj) {
        callback({ error: 'Room object not found' });
        return;
      }

      const producers = [];
      for (const [peerId, otherPeer] of roomObj.peers) {
        if (peerId !== peer.id) {
          for (const [producerId, producer] of otherPeer.producers) {
            producers.push({
              peerId,
              producerId,
              kind: producer.kind,
            });
          }
        }
      }

      callback({ producers });
    } catch (error) {
      console.error('Error getting producers:', error);
      callback({ error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    handlePeerDisconnect(socket);
  });
});

// Helper functions
function getPeerBySocket(socket) {
  for (const room of rooms.values()) {
    for (const peer of room.peers.values()) {
      if (peer.socket === socket) {
        return peer;
      }
    }
  }
  return null;
}

function getRoomByPeer(peer) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.peers.has(peer.id)) {
      return roomId;
    }
  }
  return null;
}

function getPeerByProducerId(producerId) {
  for (const room of rooms.values()) {
    for (const peer of room.peers.values()) {
      if (peer.producers.has(producerId)) {
        return peer;
      }
    }
  }
  return null;
}

function handlePeerDisconnect(socket) {
  const peer = getPeerBySocket(socket);
  if (!peer) return;

  const roomId = getRoomByPeer(peer);
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  // Close all transports
  for (const transport of peer.transports.values()) {
    transport.close();
  }

  // Remove peer from room
  room.peers.delete(peer.id);

  // Notify other peers
  try {
    if (socket && roomId && io) {
      socket.to(roomId).emit('peer-left', { peerId: peer.id });
    }
  } catch (emitError) {
    console.error('Error emitting peer-left:', emitError);
  }

  // Clean up empty rooms
  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted`);
  }
}

// Start server
const PORT = process.env.PORT || 3004;
const PROTOCOL = USE_HTTPS && sslOptions ? 'https' : 'http';

async function startServer() {
  await createWorkers();
  
  server.listen(PORT, '0.0.0.0', () => {
    const protocol = USE_HTTPS && sslOptions ? 'HTTPS' : 'HTTP';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✓ Server running on ${protocol}://0.0.0.0:${PORT}`);
    console.log(`${'='.repeat(60)}`);
    
    // Get local IP address for mobile access
    const interfaces = os.networkInterfaces();
    const localIPs = [];
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIPs.push(iface.address);
        }
      }
    }
    
    if (localIPs.length > 0) {
      console.log('\n📱 Mobile Access URLs:');
      localIPs.forEach(ip => {
        const url = `${PROTOCOL}://${ip}:${PORT}`;
        console.log(`   ${url}`);
      });
      
      if (!USE_HTTPS || !sslOptions) {
        console.log('\n⚠️  WARNING: HTTP will NOT work on mobile browsers!');
        console.log('   Mobile browsers require HTTPS for WebRTC.');
        console.log('   See HTTPS_SETUP_GUIDE.md for setup instructions.');
      } else {
        console.log('\n✓ HTTPS enabled - mobile browsers will work!');
      }
    }
    
    console.log(`\n💻 Local Access: ${PROTOCOL}://localhost:${PORT}`);
    console.log(`${'='.repeat(60)}\n`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});


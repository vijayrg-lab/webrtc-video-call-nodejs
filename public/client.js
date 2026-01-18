// WebRTC Client with MediaSoup
let socket;
let device;
let roomId;
let peerId;
let sendTransport;
let recvTransport;
let localStream;
let producers = new Map();
let consumers = new Map();
let remoteVideos = new Map();
let isInitialized = false;

const serverUrl = window.location.origin;

// ============================================================================
// Mobile Browser Detection & getUserMedia Compatibility Utilities
// ============================================================================

/**
 * Detect if running on a mobile device
 */
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));
}

/**
 * Detect iOS Safari specifically
 */
function isIOSSafari() {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) && !window.MSStream && 
           /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
}

/**
 * Detect Android Chrome
 */
function isAndroidChrome() {
    return /Android/.test(navigator.userAgent) && /Chrome/.test(navigator.userAgent);
}

/**
 * Check if HTTPS is required (not localhost)
 */
function isHTTPSRequired() {
    const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       window.location.hostname === '[::1]' ||
                       window.location.protocol === 'file:';
    return !isLocalhost && window.location.protocol !== 'https:';
}

/**
 * Check if getUserMedia is supported
 */
function isGetUserMediaSupported() {
    // Check for modern API
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        return true;
    }
    
    // Check for legacy API
    if (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia) {
        return true;
    }
    
    return false;
}

/**
 * Get mobile-friendly video constraints
 */
function getMobileVideoConstraints() {
    const isMobile = isMobileDevice();
    
    if (isMobile) {
        // Mobile-friendly constraints
        // Use lower resolution for better performance on mobile
        return {
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            facingMode: 'user', // Front-facing camera
            frameRate: { ideal: 15, max: 30 } // Lower frame rate for mobile
        };
    }
    
    // Desktop constraints
    return {
        width: { ideal: 1280 },
        height: { ideal: 720 }
    };
}

/**
 * Request user media with proper error handling and mobile support
 */
async function requestUserMedia(constraints) {
    // Check HTTPS requirement
    if (isHTTPSRequired()) {
        throw new Error('HTTPS is required for camera and microphone access. Please access this site over HTTPS or use localhost.');
    }
    
    // Check if getUserMedia is supported
    if (!isGetUserMediaSupported()) {
        const browserName = isIOSSafari() ? 'Safari' : 
                           isAndroidChrome() ? 'Chrome' : 
                           'your browser';
        throw new Error(`Camera and microphone access is not supported in ${browserName}. Please use a modern browser like Chrome, Firefox, or Safari (iOS 11+).`);
    }
    
    // Ensure mediaDevices exists (polyfill if needed)
    if (!navigator.mediaDevices) {
        // Legacy browser support
        navigator.mediaDevices = {};
    }
    
    // Polyfill getUserMedia for older browsers
    if (!navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia = function(constraints) {
            const getUserMedia = navigator.getUserMedia || 
                                navigator.webkitGetUserMedia || 
                                navigator.mozGetUserMedia ||
                                navigator.msGetUserMedia;
            
            if (!getUserMedia) {
                return Promise.reject(new Error('getUserMedia is not supported'));
            }
            
            return new Promise((resolve, reject) => {
                getUserMedia.call(navigator, constraints, resolve, reject);
            });
        };
    }
    
    try {
        // Request media with timeout
        const mediaPromise = navigator.mediaDevices.getUserMedia(constraints);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Media access request timed out. Please check your camera and microphone permissions.')), 30000);
        });
        
        const stream = await Promise.race([mediaPromise, timeoutPromise]);
        
        // Verify we got tracks
        if (!stream || (stream.getVideoTracks().length === 0 && stream.getAudioTracks().length === 0)) {
            throw new Error('No media tracks were obtained. Please check your camera and microphone.');
        }
        
        return stream;
    } catch (error) {
        // Handle specific error cases
        let errorMessage = 'Failed to access camera and microphone. ';
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage += 'Please allow camera and microphone access in your browser settings and try again.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorMessage += 'No camera or microphone found. Please connect a device and try again.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            errorMessage += 'Camera or microphone is already in use by another application.';
        } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
            errorMessage += 'Your device does not support the requested video settings. Trying with lower quality...';
            // Try with simpler constraints
            const simplerConstraints = {
                video: isMobileDevice() ? true : { facingMode: 'user' },
                audio: true
            };
            return await navigator.mediaDevices.getUserMedia(simplerConstraints);
        } else if (error.name === 'TypeError') {
            errorMessage += 'Invalid constraints. Please refresh the page and try again.';
        } else if (error.message) {
            errorMessage = error.message;
        } else {
            errorMessage += 'Unknown error occurred.';
        }
        
        // Add mobile-specific guidance
        if (isIOSSafari()) {
            errorMessage += '\n\niOS Safari Tips:\n- Make sure you\'re using iOS 11 or later\n- Check Settings > Safari > Camera/Microphone permissions\n- Try refreshing the page';
        } else if (isAndroidChrome()) {
            errorMessage += '\n\nAndroid Chrome Tips:\n- Check app permissions in Settings\n- Make sure Chrome is up to date\n- Try refreshing the page';
        }
        
        throw new Error(errorMessage);
    }
}

// Initialize
async function init() {
    try {
        // Wait for socket.io to be available
        if (typeof io === 'undefined') {
            updateStatus('Loading socket.io...', false);
            await new Promise((resolve, reject) => {
                const checkInterval = setInterval(() => {
                    if (typeof io !== 'undefined') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                
                setTimeout(() => {
                    clearInterval(checkInterval);
                    if (typeof io === 'undefined') {
                        reject(new Error('Socket.IO library failed to load. Please refresh the page.'));
                    }
                }, 10000);
            });
        }

        // Load MediaSoup client library with fallback CDNs
        if (typeof mediasoupClient === 'undefined') {
            updateStatus('Loading MediaSoup client...', false);
            
            // Try local server first, then CDN fallbacks
            const cdnSources = [
                '/mediasoup-client.min.js', // Local server (lib/index.js)
                'https://unpkg.com/mediasoup-client@3.6.55/lib/index.js',
                'https://cdn.jsdelivr.net/npm/mediasoup-client@3.6.55/lib/index.js',
                'https://unpkg.com/mediasoup-client@3/lib/index.js' // Latest version fallback
            ];
            
            let loaded = false;
            let lastError = null;
            
            for (const cdnUrl of cdnSources) {
                try {
                    await new Promise((resolve, reject) => {
                        let resolved = false;
                        const script = document.createElement('script');
                        script.src = cdnUrl;
                        script.async = true;
                        
                        script.onload = () => {
                            if (resolved) return;
                            resolved = true;
                            
                            // Check if mediasoupClient is available
                            if (typeof mediasoupClient !== 'undefined') {
                                loaded = true;
                                clearTimeout(timeoutId);
                                resolve();
                            } else {
                                // Wait a bit more for the library to initialize
                                setTimeout(() => {
                                    if (typeof mediasoupClient !== 'undefined') {
                                        loaded = true;
                                        clearTimeout(timeoutId);
                                        resolve();
                                    } else {
                                        if (!resolved) {
                                            resolved = true;
                                            reject(new Error('MediaSoup client not available after load'));
                                        }
                                    }
                                }, 500);
                            }
                        };
                        
                        script.onerror = () => {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeoutId);
                                reject(new Error(`Failed to load from ${cdnUrl}`));
                            }
                        };
                        
                        // Remove previous script if exists
                        const existingScript = document.querySelector(`script[src*="mediasoup-client"]`);
                        if (existingScript) {
                            existingScript.remove();
                        }
                        
                        document.head.appendChild(script);
                        
                        // Timeout after 15 seconds
                        const timeoutId = setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                script.remove();
                                reject(new Error(`Timeout loading from ${cdnUrl}`));
                            }
                        }, 15000);
                    });
                    
                    // Successfully loaded
                    console.log(`MediaSoup client loaded from: ${cdnUrl}`);
                    break;
                } catch (error) {
                    console.warn(`Failed to load from ${cdnUrl}:`, error.message);
                    lastError = error;
                    // Try next CDN
                    continue;
                }
            }
            
            if (!loaded || typeof mediasoupClient === 'undefined') {
                throw new Error(`Failed to load MediaSoup client from all CDN sources. Last error: ${lastError?.message || 'Unknown error'}. Please check your internet connection or try refreshing the page.`);
            }
        }

        updateStatus('Connecting to server...', false);
        
        // Connect to signaling server
        socket = io(serverUrl, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
            timeout: 10000
        });
        
        // Wait for connection
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Socket connection timeout'));
            }, 10000);

            socket.on('connect', () => {
                clearTimeout(timeout);
                console.log('Connected to server');
                updateStatus('Connected', true);
                resolve();
            });

            socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                console.error('Connection error:', error);
                updateStatus('Connection failed', false);
                reject(error);
            });
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            updateStatus('Disconnected', false);
        });

        socket.on('peer-joined', ({ peerId: newPeerId }) => {
            console.log(`Peer ${newPeerId} joined`);
        });

        socket.on('peer-left', ({ peerId: leftPeerId }) => {
            console.log(`Peer ${leftPeerId} left`);
            removeRemoteVideo(leftPeerId);
        });

        socket.on('new-producer', async ({ peerId: newPeerId, producerId, kind }) => {
            console.log(`New producer event received: ${producerId} from ${newPeerId}, kind: ${kind}`);
            
            // Don't consume our own producers
            if (newPeerId === peerId) {
                console.log('Ignoring own producer');
                return;
            }
            
            // Ensure we're ready to consume
            if (!recvTransport || !device) {
                console.warn('Not ready to consume, will retry...');
                // Retry after a delay
                setTimeout(async () => {
                    if (recvTransport && device) {
                        await consumeProducer(newPeerId, producerId, kind);
                    }
                }, 1000);
                return;
            }
            
            await consumeProducer(newPeerId, producerId, kind);
        });

        isInitialized = true;
        console.log('Initialized successfully');
        
        // Enable join button now that socket is ready
        const joinBtn = document.getElementById('joinBtn');
        if (joinBtn) {
            joinBtn.disabled = false;
        }
    } catch (error) {
        console.error('Initialization error:', error);
        updateStatus('Initialization failed: ' + error.message, false);
        alert('Failed to initialize: ' + error.message + '\n\nPlease refresh the page and try again.');
        isInitialized = false;
    }
}

function updateStatus(message, connected) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${connected ? 'connected' : 'disconnected'}`;
}

async function joinRoom() {
    // Check if initialized
    if (!isInitialized) {
        alert('Please wait for initialization to complete...');
        updateStatus('Initializing...', false);
        return;
    }

    roomId = document.getElementById('roomIdInput').value.trim();
    peerId = document.getElementById('peerIdInput').value.trim() || `peer-${Date.now()}`;

    if (!roomId) {
        alert('Please enter a room ID');
        return;
    }

    // Check if socket exists and is connected
    if (!socket) {
        alert('Socket not initialized. Please refresh the page.');
        updateStatus('Socket not initialized', false);
        return;
    }

    if (!socket.connected) {
        updateStatus('Reconnecting to server...', false);
        
        // Wait for connection with timeout
        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout. Please refresh the page.'));
                }, 10000); // 10 second timeout

                if (socket.connected) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    socket.once('connect', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    
                    socket.once('connect_error', (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                }
            });
        } catch (error) {
            alert('Failed to connect: ' + error.message);
            updateStatus('Connection failed', false);
            return;
        }
    }

    try {
        updateStatus('Joining room...', false);
        
        // Detect device type and log for debugging
        const isMobile = isMobileDevice();
        const isIOS = isIOSSafari();
        const isAndroid = isAndroidChrome();
        
        console.log('Device detection:', {
            isMobile,
            isIOS,
            isAndroid,
            userAgent: navigator.userAgent,
            protocol: window.location.protocol,
            hostname: window.location.hostname
        });
        
        // Check HTTPS requirement
        if (isHTTPSRequired()) {
            const errorMsg = 'HTTPS is required for camera and microphone access.\n\n' +
                           'Please access this site over HTTPS or use localhost.\n\n' +
                           'If you\'re testing locally, use:\n' +
                           '- http://localhost:PORT (works)\n' +
                           '- https://your-domain.com (works)\n' +
                           '- http://your-ip:PORT (does NOT work)';
            updateStatus('HTTPS required', false);
            alert(errorMsg);
            throw new Error(errorMsg);
        }
        
        // Check getUserMedia support
        if (!isGetUserMediaSupported()) {
            let errorMsg = 'Camera and microphone access is not supported in this browser.\n\n';
            
            if (isIOS) {
                errorMsg += 'iOS Safari requires iOS 11 or later for WebRTC support.\n';
                errorMsg += 'Please update your iOS version or use Chrome/Firefox on iOS.';
            } else if (isMobile) {
                errorMsg += 'Please use a modern mobile browser:\n';
                errorMsg += '- Chrome (Android)\n';
                errorMsg += '- Firefox (Android)\n';
                errorMsg += '- Safari (iOS 11+)\n';
                errorMsg += '- Edge (Android/iOS)';
            } else {
                errorMsg += 'Please use a modern browser like Chrome, Firefox, Edge, or Safari.';
            }
            
            updateStatus('Browser not supported', false);
            alert(errorMsg);
            throw new Error(errorMsg);
        }
        
        console.log('Requesting user media...');
        updateStatus('Requesting camera and microphone access...', false);
        
        // Get mobile-friendly constraints
        const videoConstraints = getMobileVideoConstraints();
        
        // Get user media with proper error handling
        try {
            localStream = await requestUserMedia({
                video: videoConstraints,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000 // Better quality for mobile
                }
            });
            
            console.log('User media obtained:', {
                videoTracks: localStream.getVideoTracks().length,
                audioTracks: localStream.getAudioTracks().length,
                videoSettings: localStream.getVideoTracks()[0]?.getSettings(),
                audioSettings: localStream.getAudioTracks()[0]?.getSettings()
            });
            
            // Log track capabilities for debugging
            if (localStream.getVideoTracks().length > 0) {
                const videoTrack = localStream.getVideoTracks()[0];
                const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
                console.log('Video capabilities:', capabilities);
            }
            
        } catch (mediaError) {
            // Enhanced error handling for media access
            console.error('Media access error:', mediaError);
            updateStatus('Media access failed', false);
            
            // Show user-friendly error
            let userMessage = mediaError.message || 'Failed to access camera and microphone.';
            
            // Add specific guidance based on error type
            if (mediaError.name === 'NotAllowedError') {
                userMessage += '\n\nPlease:\n';
                userMessage += '1. Click the camera/microphone icon in your browser\'s address bar\n';
                userMessage += '2. Allow camera and microphone access\n';
                userMessage += '3. Refresh the page and try again';
                
                if (isIOS) {
                    userMessage += '\n\nFor iOS Safari:\n';
                    userMessage += 'Go to Settings > Safari > Camera/Microphone and enable permissions';
                } else if (isAndroid) {
                    userMessage += '\n\nFor Android:\n';
                    userMessage += 'Go to Chrome Settings > Site Settings > Camera/Microphone';
                }
            }
            
            alert(userMessage);
            throw mediaError;
        }

        // Create send transport
        const transportInfo = await new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Socket is not connected'));
                return;
            }

            socket.emit('join-room', { roomId, peerId }, (response) => {
                if (!response) {
                    reject(new Error('No response from server'));
                    return;
                }
                if (response.error) {
                    reject(new Error(response.error));
                } else {
                    resolve(response);
                }
            });
        });

        // Initialize device
        device = new mediasoupClient.Device();
        
        // Define codec variables in outer scope for error handling
        let routerAudioCodecs = [];
        let deviceAudioCodecs = [];
        let commonAudioCodecs = [];
        
        try {
            // Log router capabilities before loading
            console.log('Router RTP capabilities:', JSON.stringify(transportInfo.routerRtpCapabilities, null, 2));
            
            // Check browser codec support before loading
            if (navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints) {
                const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
                console.log('Browser supported constraints:', supportedConstraints);
            }
            
            await device.load({ routerRtpCapabilities: transportInfo.routerRtpCapabilities });
            
            // Verify device is properly loaded
            if (!device.loaded) {
                throw new Error('Device failed to load properly');
            }
            
            // Check if device has RTP capabilities
            if (!device.rtpCapabilities || !device.rtpCapabilities.codecs) {
                throw new Error('Device RTP capabilities not available');
            }
            
            console.log('Device loaded successfully. Browser:', device.handlerName);
            console.log('Device RTP capabilities:', JSON.stringify(device.rtpCapabilities, null, 2));
            
            const audioCodecs = device.rtpCapabilities.codecs.filter(c => c.kind === 'audio');
            const videoCodecs = device.rtpCapabilities.codecs.filter(c => c.kind === 'video');
            
            console.log('Available audio codecs:', audioCodecs.map(c => c.mimeType));
            console.log('Available video codecs:', videoCodecs.map(c => c.mimeType));
            
            // Check for audio codec compatibility
            if (audioCodecs.length === 0) {
                throw new Error('No audio codecs available. Your browser may not support required audio codecs.');
            }
            
            // Verify at least one common codec exists between router and device
            routerAudioCodecs = transportInfo.routerRtpCapabilities.codecs.filter(c => c.kind === 'audio').map(c => c.mimeType);
            deviceAudioCodecs = audioCodecs.map(c => c.mimeType);
            commonAudioCodecs = routerAudioCodecs.filter(codec => deviceAudioCodecs.includes(codec));
            
            if (commonAudioCodecs.length === 0) {
                const errorMsg = `No common audio codecs found between router and device.\nRouter audio codecs: ${routerAudioCodecs.join(', ')}\nDevice audio codecs: ${deviceAudioCodecs.join(', ')}\n\nPlease ensure your browser supports Opus audio codec.`;
                console.error(errorMsg);
                throw new Error(errorMsg);
            } else {
                console.log('Common audio codecs:', commonAudioCodecs);
                console.log('Using audio codec:', commonAudioCodecs[0]);
            }
            
            // Also check video codecs
            const routerVideoCodecs = transportInfo.routerRtpCapabilities.codecs.filter(c => c.kind === 'video').map(c => c.mimeType);
            const deviceVideoCodecs = videoCodecs.map(c => c.mimeType);
            const commonVideoCodecs = routerVideoCodecs.filter(codec => deviceVideoCodecs.includes(codec));
            
            if (commonVideoCodecs.length === 0) {
                console.warn('No common video codecs found between router and device');
                console.warn('Router video codecs:', routerVideoCodecs);
                console.warn('Device video codecs:', deviceVideoCodecs);
            } else {
                console.log('Common video codecs:', commonVideoCodecs);
            }
            
        } catch (error) {
            console.error('Device load error:', error);
            console.error('Error details:', error.stack);
            throw new Error(`Failed to load MediaSoup device: ${error.message}. Your browser may not support required codecs.`);
        }

        // Create send transport
        try {
            sendTransport = device.createSendTransport({
                id: transportInfo.sendTransport.id,
                iceParameters: transportInfo.sendTransport.iceParameters,
                iceCandidates: transportInfo.sendTransport.iceCandidates,
                dtlsParameters: transportInfo.sendTransport.dtlsParameters,
                sctpParameters: transportInfo.sendTransport.sctpParameters,
            });
            
            console.log('Send transport created:', sendTransport.id);
        } catch (error) {
            console.error('Failed to create send transport:', error);
            throw new Error(`Failed to create send transport: ${error.message}`);
        }

        sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                if (!socket || !socket.connected) {
                    errback(new Error('Socket is not connected'));
                    return;
                }

                if (!dtlsParameters) {
                    errback(new Error('dtlsParameters is missing'));
                    return;
                }

                console.log('Connecting send transport:', sendTransport.id);
                console.log('DTLS parameters:', JSON.stringify(dtlsParameters, null, 2));

                socket.emit('connect-transport', {
                    transportId: sendTransport.id,
                    dtlsParameters,
                }, (response) => {
                    if (!response) {
                        errback(new Error('No response from server'));
                        return;
                    }
                    if (response.error) {
                        console.error('Send transport connect error:', response.error);
                        errback(new Error(response.error));
                    } else {
                        console.log('Send transport connected successfully');
                        // Small delay to ensure connection is stable
                        setTimeout(() => {
                            callback();
                        }, 100);
                    }
                });
            } catch (error) {
                console.error('Send transport connect exception:', error);
                errback(error);
            }
        });

        sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            try {
                if (!socket || !socket.connected) {
                    errback(new Error('Socket is not connected'));
                    return;
                }

                console.log(`Producing ${kind} track with parameters:`, rtpParameters);

                socket.emit('produce', {
                    transportId: sendTransport.id,
                    kind,
                    rtpParameters,
                }, (response) => {
                    if (!response) {
                        errback(new Error('No response from server'));
                        return;
                    }
                    if (response.error) {
                        console.error('Produce error:', response.error);
                        errback(new Error(response.error));
                    } else {
                        console.log(`Producer created: ${response.id} for ${kind}`);
                        callback({ id: response.id });
                    }
                });
            } catch (error) {
                console.error('Produce exception:', error);
                errback(error);
            }
        });

        // Add error handler for transport
        let sendTransportConnected = false;
        sendTransport.on('connectionstatechange', (state) => {
            console.log('Send transport connection state:', state);
            if (state === 'connected') {
                sendTransportConnected = true;
            }
            if (state === 'failed' || state === 'disconnected') {
                console.log('Send transport connection failed');
                sendTransportConnected = false;
            }
        });

        // Create receive transport
        try {
            recvTransport = device.createRecvTransport({
                id: transportInfo.recvTransport.id,
                iceParameters: transportInfo.recvTransport.iceParameters,
                iceCandidates: transportInfo.recvTransport.iceCandidates,
                dtlsParameters: transportInfo.recvTransport.dtlsParameters,
                sctpParameters: transportInfo.recvTransport.sctpParameters,
            });
            
            console.log('Receive transport created:', recvTransport.id);
        } catch (error) {
            console.error('Failed to create receive transport:', error);
            throw new Error(`Failed to create receive transport: ${error.message}`);
        }

        recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                console.log('🔄 Receive transport connect event triggered');
                
                if (!socket || !socket.connected) {
                    const error = new Error('Socket is not connected');
                    console.error('❌', error.message);
                    errback(error);
                    return;
                }

                if (!dtlsParameters) {
                    const error = new Error('dtlsParameters is missing');
                    console.error('❌', error.message);
                    errback(error);
                    return;
                }

                console.log('🔄 Connecting receive transport:', recvTransport.id);
                console.log('DTLS fingerprint:', dtlsParameters.fingerprints?.[0]?.value);

                // Set timeout for connection attempt
                const connectTimeout = setTimeout(() => {
                    console.error('❌ Receive transport connect timeout after 10 seconds');
                    errback(new Error('Receive transport connection timeout'));
                }, 10000); // 10 second timeout

                socket.emit('connect-transport', {
                    transportId: recvTransport.id,
                    dtlsParameters,
                }, (response) => {
                    clearTimeout(connectTimeout);
                    
                    if (!response) {
                        const error = new Error('No response from server');
                        console.error('❌', error.message);
                        errback(error);
                        return;
                    }
                    
                    if (response.error) {
                        console.error('❌ Receive transport connect error from server:', response.error);
                        console.error('Error details:', {
                            transportId: recvTransport.id,
                            error: response.error
                        });
                        errback(new Error(response.error));
                    } else {
                        console.log('✅ Receive transport connect response received from server');
                        // Small delay to ensure connection is stable
                        setTimeout(() => {
                            callback();
                            console.log('✅ Receive transport connect callback executed');
                        }, 100);
                    }
                });
            } catch (error) {
                console.error('❌ Receive transport connect exception:', error);
                console.error('Exception details:', {
                    message: error.message,
                    stack: error.stack,
                    transportId: recvTransport.id
                });
                errback(error);
            }
        });

        // Add comprehensive error handler for receive transport
        let recvTransportConnected = false;
        let recvTransportFailureCount = 0;
        
        recvTransport.on('connectionstatechange', (state) => {
            console.log('Receive transport connection state changed:', state);
            console.log('Receive transport ID:', recvTransport.id);
            
            if (state === 'connected') {
                recvTransportConnected = true;
                recvTransportFailureCount = 0; // Reset failure count on success
                console.log('✅ Receive transport connected successfully');
                
                // Clear any previous error messages
                const statusEl = document.getElementById('status');
                if (statusEl && statusEl.textContent.includes('receive transport')) {
                    updateStatus('Connected', true);
                }
            } else if (state === 'connecting') {
                console.log('⏳ Receive transport connecting...');
            } else if (state === 'failed') {
                recvTransportConnected = false;
                recvTransportFailureCount++;
                console.error('❌ Receive transport connection FAILED');
                console.error('Failure count:', recvTransportFailureCount);
                
                // Log additional diagnostic information
                console.error('Receive transport details:', {
                    id: recvTransport.id,
                    state: recvTransport.connectionState,
                    appData: recvTransport.appData
                });
                
                // Check if this is blocking remote video
                if (consumers.size > 0) {
                    console.warn('⚠️ Receive transport failed but consumers exist - remote video may not work');
                }
                
                // Show user-friendly error message
                if (recvTransportFailureCount === 1) {
                    // Only show on first failure to avoid spam
                    updateStatus('Connection issue: Cannot receive remote video/audio. Check console for details.', false);
                    console.error('💡 Troubleshooting tips:');
                    console.error('  1. Check your network connection');
                    console.error('  2. Check firewall settings');
                    console.error('  3. Try refreshing the page');
                    console.error('  4. Check server logs for errors');
                }
                
                // Note: In MediaSoup, receive transport connects automatically when consuming
                // A failure here might recover when we try to consume
            } else if (state === 'disconnected') {
                recvTransportConnected = false;
                console.warn('⚠️ Receive transport disconnected');
                console.warn('⚠️ Remote video/audio will stop working');
                updateStatus('Connection lost. Remote video/audio may not work.', false);
            } else if (state === 'new') {
                console.log('ℹ️ Receive transport in new state (will connect when needed)');
            }
            
            // CRITICAL: If transport reconnected, resume all paused consumers
            if (state === 'connected' && recvTransportFailureCount > 0) {
                console.log('🔄 Transport reconnected - resuming paused consumers...');
                consumers.forEach(({ consumer, peerId, kind }) => {
                    if (consumer.paused) {
                        console.log(`Resuming consumer after transport reconnect: ${consumer.id} (${kind} from ${peerId})`);
                        consumer.resume();
                        if (socket && socket.connected) {
                            socket.emit('resume-consumer', { consumerId: consumer.id }, (response) => {
                                if (response && response.error) {
                                    console.error('Error resuming consumer after reconnect:', response.error);
                                } else {
                                    console.log('✅ Consumer resumed after transport reconnect:', consumer.id);
                                }
                            });
                        }
                    }
                });
                recvTransportFailureCount = 0; // Reset failure count
            }
        });
        
        // Add error event listener for additional error details
        recvTransport.on('error', (error) => {
            console.error('❌ Receive transport error event:', error);
            console.error('Error details:', {
                message: error.message,
                name: error.name,
                stack: error.stack
            });
        });

        // Ensure both transports are ready before producing tracks
        // The receive transport needs to be properly initialized, even if not fully connected,
        // because MediaSoup may need to update its SDP when producing tracks
        console.log('Checking transport states before producing...');
        console.log('Initial receive transport state:', recvTransport.connectionState);
        console.log('Initial send transport state:', sendTransport.connectionState);
        
        // Wait for send transport to be connected (required for producing)
        if (sendTransport.connectionState !== 'connected') {
            console.log('Waiting for send transport to connect...');
            let sendWaitCount = 0;
            while (sendTransport.connectionState !== 'connected' && sendWaitCount < 50) {
                if (sendWaitCount % 10 === 0) {
                    console.log(`Send transport state (${sendWaitCount}/50):`, sendTransport.connectionState);
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                sendWaitCount++;
            }
            
            if (sendTransport.connectionState !== 'connected') {
                console.warn('Send transport did not connect in time');
            } else {
                console.log('Send transport is now connected');
            }
        }
        
        // CRITICAL: Ensure receive transport handler is initialized before producing
        // MediaSoup needs the receive transport's internal handler to be ready
        // when creating SDP offers, even though the transport itself isn't connected
        console.log('Initializing receive transport handler for SDP negotiation...');
        
        // The receive transport handler needs to be ready for MediaSoup to set
        // receive parameters in the SDP offer. We ensure this by:
        // 1. Waiting for the transport to be fully initialized
        // 2. Ensuring the handler factory has created the handler
        // 3. Giving MediaSoup time to set up internal state
        
        if (recvTransport.connectionState === 'new') {
            console.log('Receive transport is new - ensuring handler is initialized...');
            // Access transport properties to trigger handler initialization if needed
            // This ensures MediaSoup's internal handler is ready for SDP negotiation
            const recvTransportId = recvTransport.id;
            console.log('Receive transport ID:', recvTransportId);
            
            // Give MediaSoup time to initialize the handler
            // The handler needs to be ready before we can set receive parameters
            await new Promise(resolve => setTimeout(resolve, 500));
        } else if (recvTransport.connectionState === 'connecting') {
            console.log('Receive transport is connecting, waiting...');
            let recvWaitCount = 0;
            while (recvTransport.connectionState === 'connecting' && recvWaitCount < 30) {
                await new Promise(resolve => setTimeout(resolve, 100));
                recvWaitCount++;
            }
        }
        
        console.log('Final transport states before production:');
        console.log('  Receive transport:', recvTransport.connectionState);
        console.log('  Send transport:', sendTransport.connectionState);
        
        console.log('Proceeding with track production (audio first, then video)...');

        // Produce local tracks - CRITICAL: Produce audio FIRST to avoid SDP conflicts
        // MediaSoup needs the receive transport to be ready when producing, and producing
        // audio first ensures simpler SDP negotiation without video m-sections interfering
        try {
            let audioError = null;
            
            // PRODUCE AUDIO FIRST - This is critical for MediaSoup SDP negotiation
            // The receive transport needs to be ready, and producing audio first
            // ensures proper SDP m-section ordering
            if (localStream.getAudioTracks().length > 0) {
                // Get a fresh reference to the audio track right before producing
                // This ensures we have the most up-to-date track state
                let audioTrack = localStream.getAudioTracks().find(track => track.readyState === 'live');
                
                if (!audioTrack) {
                    console.warn('No active audio track found - checking all audio tracks...');
                    const allAudioTracks = localStream.getAudioTracks();
                    console.log('All audio tracks:', allAudioTracks.map(t => ({ id: t.id, readyState: t.readyState, enabled: t.enabled })));
                    
                    // Try to get the first track even if not live
                    audioTrack = allAudioTracks[0];
                    if (audioTrack && audioTrack.readyState !== 'live') {
                        console.warn(`Audio track state is ${audioTrack.readyState}, not 'live'`);
                    }
                }
                
                if (!audioTrack) {
                    console.error('No audio track available for production');
                    updateStatus('Connected (video only - no audio track)', true);
                } else {
                    console.log('Producing audio track:', audioTrack.id, audioTrack.kind);
                    console.log('Audio track state:', audioTrack.readyState);
                    console.log('Audio track enabled:', audioTrack.enabled);
                    console.log('Audio track settings:', audioTrack.getSettings());
                    
                    // Check transport states before producing audio
                    console.log('Transport states before audio produce:');
                    console.log('  Receive transport:', recvTransport.connectionState);
                    console.log('  Send transport:', sendTransport.connectionState);
                    
                    // Note: Receive transport connects lazily (only when consuming), not during production
                    // MediaSoup should handle the receive transport connection automatically when needed
                    // The send transport should be connected after video production, but let's verify
                    
                    // Ensure send transport is connected (it should be after video production)
                    if (sendTransport.connectionState !== 'connected') {
                        console.log('Send transport not connected, waiting for connection...');
                        let sendWaitCount = 0;
                        while (sendTransport.connectionState !== 'connected' && sendWaitCount < 50) {
                            if (sendWaitCount % 10 === 0) {
                                console.log(`Waiting for send transport to connect (${sendWaitCount}/50): ${sendTransport.connectionState}`);
                            }
                            await new Promise(resolve => setTimeout(resolve, 100));
                            sendWaitCount++;
                        }
                        
                        if (sendTransport.connectionState !== 'connected') {
                            console.log('Send transport did not connect - audio production may fail');
                        } else {
                            console.log('Send transport is now connected');
                        }
                    }
                    
                    // CRITICAL FIX: Ensure receive transport is ready for SDP negotiation
                    // MediaSoup needs the receive transport to be initialized (not just created)
                    // when producing audio, because it creates an SDP offer that includes
                    // receive parameters for the receive transport
                    
                    // The receive transport needs to have its internal handler ready
                    // Even though it's in 'new' state, we need to ensure it's initialized
                    // We can do this by ensuring the transport's internal state is ready
                    console.log('Ensuring receive transport is ready for SDP negotiation...');
                    
                    // Give the receive transport time to initialize its internal handler
                    // This is necessary because MediaSoup will try to set receive parameters
                    // when creating the SDP offer for audio production
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    // Verify receive transport is properly initialized
                    // Accessing the transport's connection state helps ensure it's ready
                    const recvState = recvTransport.connectionState;
                    console.log('Receive transport state before audio production:', recvState);
                    
                    // Brief wait to ensure send transport is stable
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    // Try producing audio track with retry logic
                    let audioProducer = null;
                    const maxRetries = 2;
                    
                    for (let retry = 0; retry <= maxRetries; retry++) {
                        try {
                            // Get a fresh reference to the audio track before each attempt
                            // The track might have changed or ended during waits
                            const currentAudioTrack = localStream.getAudioTracks().find(track => track.readyState === 'live');
                            
                            if (!currentAudioTrack) {
                                throw new Error('Audio track ended or not available');
                            }
                            
                            if (retry > 0) {
                                console.log(`Retrying audio production (attempt ${retry + 1}/${maxRetries + 1})...`);
                                // Wait a bit longer before retry
                                await new Promise(resolve => setTimeout(resolve, 500));
                                
                                // Check transport states before retry
                                console.log('Transport states before retry:');
                                console.log('  Receive transport:', recvTransport.connectionState);
                                console.log('  Send transport:', sendTransport.connectionState);
                                console.log('  Audio track state:', currentAudioTrack.readyState);
                            } else {
                                console.log('Attempting to produce audio track...');
                            }
                            
                            // CRITICAL FIX: Produce with stopTracks: false to prevent track stopping
                            // and ensure proper SDP negotiation
                            // MediaSoup needs the receive transport handler to be ready
                            audioProducer = await sendTransport.produce({ 
                                track: currentAudioTrack,
                                stopTracks: false  // Don't stop tracks - let MediaSoup handle it
                            });
                            producers.set('audio', audioProducer);
                            console.log('Audio producer created:', audioProducer.id);
                            audioError = null; // Success, clear error
                            break;
                        } catch (err) {
                            audioError = err;
                            console.log(`Audio production attempt ${retry + 1} failed:`, err.message);
                        
                        // Check if this is a retryable error
                        const isRetryableError = (err.message && 
                            (err.message.includes('recv parameters') || 
                             err.message.includes('track ended'))) && 
                            retry < maxRetries;
                        
                        if (isRetryableError) {
                            if (err.message.includes('track ended')) {
                                console.log('Track ended error detected - checking for available audio tracks...');
                                // Check if there are any live audio tracks available
                                const liveAudioTracks = localStream.getAudioTracks().filter(track => track.readyState === 'live');
                                if (liveAudioTracks.length === 0) {
                                    console.error('No live audio tracks available - cannot retry');
                                    break; // Can't retry if no tracks available
                                } else {
                                    console.log(`Found ${liveAudioTracks.length} live audio track(s) - will retry`);
                                }
                            } else {
                                console.log('Recv parameters error detected, will retry after ensuring transports are ready...');
                            }
                            
                            // Note: Receive transport stays in 'new' state until we consume something
                            // This is normal - MediaSoup handles it internally
                            // We just need to ensure the send transport is connected
                            
                            // Ensure send transport is connected
                            if (sendTransport.connectionState !== 'connected') {
                                console.log('Ensuring send transport is connected before retry...');
                                let sendWaitCount = 0;
                                while (sendTransport.connectionState !== 'connected' && sendWaitCount < 50) {
                                    if (sendWaitCount % 10 === 0) {
                                        console.log(`Waiting for send transport (${sendWaitCount}/50): ${sendTransport.connectionState}`);
                                    }
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                    sendWaitCount++;
                                }
                                
                                if (sendTransport.connectionState === 'connected') {
                                    console.log('Send transport is now connected');
                                } else {
                                    console.warn(`Send transport did not connect: ${sendTransport.connectionState}`);
                                }
                            }
                            
                            // Give MediaSoup time to handle the receive transport internally
                            // The receive transport will remain in 'new' state, which is expected
                            console.log(`Receive transport state: ${recvTransport.connectionState} (this is normal - it connects when consuming)`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } else {
                            // Not a retryable error or max retries reached
                            break;
                        }
                    }
                }
            }
            
            // PRODUCE VIDEO AFTER AUDIO - This ensures audio SDP is negotiated first
            // Video production is simpler and won't interfere with audio SDP
            if (localStream.getVideoTracks().length > 0) {
                const videoTrack = localStream.getVideoTracks()[0];
                console.log('Producing video track:', videoTrack.id, videoTrack.kind);
                console.log('Video track settings:', videoTrack.getSettings());
                
                try {
                    // Video production should work fine now that audio is done
                    const videoProducer = await sendTransport.produce({ track: videoTrack });
                    producers.set('video', videoProducer);
                    console.log('Video producer created:', videoProducer.id);
                } catch (videoError) {
                    console.log('Error producing video track:', videoError);
                    // Continue even if video fails - audio is more important
                }
            }
            
            // Handle audio production errors (outside the else block so it's accessible)
            if (audioError) {
                    console.warn('Error producing audio track:', audioError);
                    console.warn('Error details:', {
                        message: audioError.message,
                        name: audioError.name,
                        stack: audioError.stack
                    });
                    
                    // Check if it's actually a codec compatibility issue
                    // Only show codec compatibility error if there are NO common codecs
                    const isCodecIssue = commonAudioCodecs.length === 0;
                    
                    if (isCodecIssue) {
                        console.log('=== CODEC COMPATIBILITY ISSUE DETECTED ===');
                        console.log('Router audio codecs:', routerAudioCodecs);
                        console.log('Device audio codecs:', deviceAudioCodecs);
                        console.log('Common audio codecs:', commonAudioCodecs);
                        
                        // Log detailed codec information
                        console.log('--- Router Audio Codecs Details ---');
                        const routerAudioDetails = [];
                        transportInfo.routerRtpCapabilities.codecs
                            .filter(c => c.kind === 'audio')
                            .forEach(codec => {
                                const detail = `${codec.mimeType} (clockRate: ${codec.clockRate}, channels: ${codec.channels || 'N/A'})`;
                                routerAudioDetails.push(detail);
                                console.log(`  - ${detail}`);
                            });
                        
                        console.log('--- Device Audio Codecs Details ---');
                        const deviceAudioDetails = [];
                        device.rtpCapabilities.codecs
                            .filter(c => c.kind === 'audio')
                            .forEach(codec => {
                                const detail = `${codec.mimeType} (clockRate: ${codec.clockRate}, channels: ${codec.channels || 'N/A'})`;
                                deviceAudioDetails.push(detail);
                                console.log(`  - ${detail}`);
                            });
                        
                        console.log('Device RTP capabilities (full):', JSON.stringify(device.rtpCapabilities, null, 2));
                        console.log('Router RTP capabilities (full):', JSON.stringify(transportInfo.routerRtpCapabilities, null, 2));
                        console.log('==========================================');
                        
                        // Show alert with codec information
                        const codecInfo = `CODEC COMPATIBILITY ISSUE DETECTED\n\nRouter supports:\n${routerAudioDetails.join('\n')}\n\nBrowser supports:\n${deviceAudioDetails.join('\n')}\n\nCommon codecs:\nNONE - This is the problem!\n\nPlease check browser console for full details.\nVideo call will continue without audio.`;
                        alert(codecInfo);
                        console.log(codecInfo);
                        
                        // Inform user but continue with video only
                        console.log('Continuing with video only - audio will not be available');
                        updateStatus('Connected (video only - audio unavailable)', true);
                    } else {
                        // Common codecs exist, so this is NOT a codec compatibility issue
                        // Log diagnostic information for debugging
                        console.log('=== AUDIO PRODUCTION ERROR (NOT CODEC COMPATIBILITY) ===');
                        console.log('Common audio codecs found:', commonAudioCodecs);
                        console.log('Router audio codecs:', routerAudioCodecs);
                        console.log('Device audio codecs:', deviceAudioCodecs);
                        console.log('Send transport state:', sendTransport.connectionState);
                        console.log('Receive transport state:', recvTransport.connectionState);
                        console.log('Error message:', audioError.message);
                        
                        // Check audio track state
                        const audioTracks = localStream.getAudioTracks();
                        console.log('Audio tracks state:', audioTracks.map(t => ({ id: t.id, readyState: t.readyState, enabled: t.enabled })));
                        console.log('==========================================');
                        
                        // Show a more helpful error message based on error type
                        let errorInfo;
                        if (audioError.message && audioError.message.includes('track ended')) {
                            errorInfo = `AUDIO TRACK ENDED\n\nCommon codecs found: ${commonAudioCodecs.join(', ')}\n\nError: ${audioError.message}\n\nThe audio track ended before it could be produced. This may happen if:\n- The microphone permission was revoked\n- The browser stopped the track\n- The track timed out\n\nPlease check browser console for full details.\nVideo call will continue without audio.`;
                        } else {
                            errorInfo = `AUDIO PRODUCTION ERROR\n\nCommon codecs found: ${commonAudioCodecs.join(', ')}\n\nError: ${audioError.message}\n\nThis appears to be a transport or connection issue, not a codec compatibility problem.\n\nPlease check browser console for full details.\nVideo call will continue without audio.`;
                        }
                        console.warn(errorInfo);
                        
                        // Inform user but continue with video only
                        console.log('Continuing with video only - audio will not be available');
                        updateStatus('Connected (video only - audio unavailable)', true);
                    }
                    
                    // Don't throw error - continue with video only
                    // Audio is optional for video calls
                }
            }
        } catch (produceError) {
            console.log('Error producing tracks:', produceError);
            // throw new Error(`Failed to produce tracks: ${produceError.message}`);
        }

        // Display local video
        displayLocalVideo();

        // Get existing producers (for peers already in the room)
        if (socket && socket.connected) {
            console.log('Requesting existing producers...');
            socket.emit('get-producers', (response) => {
                if (response && response.error) {
                    console.error('Error getting producers:', response.error);
                    return;
                }
                
                if (response && response.producers && response.producers.length > 0) {
                    console.log(`Found ${response.producers.length} existing producer(s) to consume`);
                    response.producers.forEach(({ peerId: pId, producerId, kind }) => {
                        // Don't consume our own producers
                        if (pId !== peerId) {
                            console.log(`Consuming existing ${kind} producer from ${pId}:`, producerId);
                            consumeProducer(pId, producerId, kind);
                        }
                    });
                } else {
                    console.log('No existing producers found');
                }
            });
        }

        // Update UI
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('leaveBtn').disabled = false;
        document.getElementById('toggleVideoBtn').disabled = false;
        document.getElementById('toggleAudioBtn').disabled = false;
        document.getElementById('roomIdInput').disabled = true;
        document.getElementById('peerIdInput').disabled = true;

        updateStatus(`Connected to room: ${roomId}`, true);
        console.log(`Joined room ${roomId} as ${peerId}`);
    } catch (error) {
        console.error('Error joining room:', error);
        
        // Clean up any tracks that were obtained
        if (localStream) {
            localStream.getTracks().forEach(track => {
                track.stop();
                console.log('Stopped track:', track.kind, track.id);
            });
            localStream = null;
        }
        
        // Show user-friendly error message
        let errorMessage = error.message || 'Failed to join room';
        
        // Don't show alert if it's a user cancellation (they already saw the permission prompt)
        if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
            // Format error message for better readability
            const formattedMessage = errorMessage.split('\n').join('\n');
            alert(formattedMessage);
        }
        
        updateStatus('Failed to join room', false);
    }
}

/**
 * Check media device support on page load and show warnings if needed
 */
function checkMediaDeviceSupport() {
    const warnings = [];
    
    // Check HTTPS
    if (isHTTPSRequired()) {
        warnings.push('⚠️ HTTPS is required for camera/microphone access');
    }
    
    // Check getUserMedia support
    if (!isGetUserMediaSupported()) {
        const deviceType = isMobileDevice() ? 'mobile' : 'desktop';
        warnings.push(`⚠️ Camera/microphone access not supported on this ${deviceType} browser`);
    }
    
    // Check iOS Safari version
    if (isIOSSafari()) {
        const iosVersion = navigator.userAgent.match(/OS (\d+)_(\d+)/);
        if (iosVersion) {
            const majorVersion = parseInt(iosVersion[1]);
            if (majorVersion < 11) {
                warnings.push('⚠️ iOS Safari requires iOS 11+ for WebRTC support');
            }
        }
    }
    
    // Log warnings to console
    if (warnings.length > 0) {
        console.warn('Media Device Support Warnings:');
        warnings.forEach(warning => console.warn(warning));
    }
    
    return warnings.length === 0;
}

async function consumeProducer(remotePeerId, producerId, kind) {
    try {
        console.log(`Consuming ${kind} producer:`, { remotePeerId, producerId });
        
        if (!socket || !socket.connected) {
            console.error('Socket is not connected, cannot consume producer');
            return;
        }

        if (!recvTransport || !device) {
            console.error('Transport or device not initialized');
            return;
        }
        
        // CRITICAL: Ensure receive transport is connected before consuming
        // The receive transport MUST be connected for consumers to receive data
        const currentState = recvTransport.connectionState;
        console.log('📊 Receive transport state before consume:', currentState);
        
        // Handle failed state - cannot proceed
        if (currentState === 'failed') {
            console.error('❌ Receive transport is in FAILED state - cannot consume');
            console.error('This WILL prevent remote video from displaying');
            console.error('Possible causes:');
            console.error('  - Network connectivity issues');
            console.error('  - Firewall blocking WebRTC');
            console.error('  - Server-side transport error');
            console.error('  - DTLS handshake failure');
            console.error('  - ICE connection failure');
            console.error('Try refreshing the page or check network connectivity');
            throw new Error('Receive transport is in failed state - cannot consume producer');
        }
        
        // Handle disconnected state - wait for reconnection
        if (currentState === 'disconnected') {
            console.warn('⚠️ Receive transport is DISCONNECTED - waiting for reconnection...');
            // MediaSoup may reconnect automatically when we try to consume
        }
        
        // Wait for transport to connect if needed
        if (currentState === 'new' || currentState === 'connecting' || currentState === 'disconnected') {
            console.log('⏳ Receive transport not connected, waiting for connection...');
            let waitCount = 0;
            const maxWait = 100; // 10 seconds (increased timeout)
            
            while ((recvTransport.connectionState === 'new' || 
                    recvTransport.connectionState === 'connecting' ||
                    recvTransport.connectionState === 'disconnected') && 
                   waitCount < maxWait) {
                if (waitCount % 10 === 0) {
                    console.log(`⏳ Waiting for receive transport (${waitCount}/${maxWait}):`, recvTransport.connectionState);
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
            
            const finalState = recvTransport.connectionState;
            if (finalState === 'connected') {
                console.log('✅ Receive transport connected, proceeding with consume');
            } else if (finalState === 'failed') {
                console.error('❌ Receive transport failed during wait - cannot consume');
                throw new Error('Receive transport failed - cannot consume producer');
            } else if (finalState === 'disconnected') {
                console.error('❌ Receive transport still disconnected after wait');
                console.error('Remote video will NOT work without connected transport');
                throw new Error('Receive transport disconnected - cannot consume producer');
            } else {
                console.warn('⚠️ Receive transport state:', finalState, '- proceeding with consume anyway');
                console.warn('MediaSoup may connect the transport automatically during consume');
                console.warn('If video doesn\'t appear, check transport state');
            }
        } else if (currentState === 'connected') {
            console.log('✅ Receive transport already connected');
        }

        const response = await new Promise((resolve, reject) => {
            socket.emit('consume', {
                transportId: recvTransport.id,
                producerId,
                rtpCapabilities: device.rtpCapabilities,
            }, (response) => {
                if (!response) {
                    reject(new Error('No response from server'));
                    return;
                }
                if (response.error) {
                    console.error('Consume error from server:', response.error);
                    reject(new Error(response.error));
                } else {
                    console.log(`Consume response received for ${kind}:`, response.id);
                    resolve(response);
                }
            });
        });

        console.log('Creating consumer for:', { id: response.id, producerId: response.producerId, kind: response.kind });
        
        const consumer = await recvTransport.consume({
            id: response.id,
            producerId: response.producerId,
            kind: response.kind,
            rtpParameters: response.rtpParameters,
        });

        console.log('Consumer created:', consumer.id, 'Track state:', consumer.track.readyState);

        consumers.set(consumer.id, { consumer, peerId: remotePeerId, kind });
        
        // Add track event listeners for debugging
        consumer.track.addEventListener('ended', () => {
            console.warn('Consumer track ended:', consumer.id, remotePeerId);
        });
        
        consumer.track.addEventListener('mute', () => {
            console.log('Consumer track muted:', consumer.id, remotePeerId);
        });
        
        consumer.track.addEventListener('unmute', () => {
            console.log('Consumer track unmuted:', consumer.id, remotePeerId);
        });

        // CRITICAL: Resume consumer to start receiving data
        // MediaSoup pauses consumers by default - they MUST be resumed
        console.log('Consumer state before resume:', {
            paused: consumer.paused,
            trackState: consumer.track.readyState,
            trackMuted: consumer.track.muted,
            transportState: recvTransport.connectionState
        });

        // Verify transport is connected before resuming
        if (recvTransport.connectionState !== 'connected') {
            console.error('❌ Cannot resume consumer - receive transport not connected');
            console.error('Transport state:', recvTransport.connectionState);
            throw new Error(`Receive transport is ${recvTransport.connectionState}, cannot resume consumer`);
        }

        // Resume consumer (client-side)
        if (consumer.paused) {
            console.log('🔄 Resuming paused consumer:', consumer.id);
            consumer.resume();
        } else {
            console.log('ℹ️ Consumer already resumed:', consumer.id);
        }

        // Notify server to resume consumer (REQUIRED)
        await new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Socket is not connected'));
                return;
            }

            socket.emit('resume-consumer', { consumerId: consumer.id }, (response) => {
                if (response && response.error) {
                    console.error('❌ Resume consumer error from server:', response.error);
                    reject(new Error(response.error));
                } else {
                    console.log('✅ Consumer resumed on server:', consumer.id);
                    resolve();
                }
            });
        });

        // Verify consumer is actually resumed
        await new Promise(resolve => setTimeout(resolve, 200)); // Give it time to process
        
        if (consumer.paused) {
            console.error('❌ Consumer still paused after resume - retrying...');
            consumer.resume();
            await new Promise(resolve => setTimeout(resolve, 200));
            
            if (consumer.paused) {
                console.error('❌ Consumer still paused after retry - this is a problem!');
                console.error('Transport state:', recvTransport.connectionState);
                console.error('Track state:', consumer.track.readyState);
            }
        }

        // Check track muted state
        if (consumer.track.muted) {
            console.warn('⚠️ Consumer track is muted - waiting for unmute...');
            console.warn('This may cause black video screen');
            
            // Wait for unmute event (with timeout)
            await new Promise((resolve) => {
                const unmuteHandler = () => {
                    console.log('✅ Consumer track unmuted');
                    consumer.track.removeEventListener('unmute', unmuteHandler);
                    resolve();
                };
                
                consumer.track.addEventListener('unmute', unmuteHandler);
                
                // Timeout after 3 seconds
                setTimeout(() => {
                    consumer.track.removeEventListener('unmute', unmuteHandler);
                    console.warn('⚠️ Track unmute timeout - proceeding anyway');
                    resolve();
                }, 3000);
            });
        }

        // Final state check before displaying
        console.log('Consumer state after resume:', {
            paused: consumer.paused,  // Should be false
            trackState: consumer.track.readyState,  // Should be 'live'
            trackMuted: consumer.track.muted,  // Should be false
            transportState: recvTransport.connectionState  // Should be 'connected'
        });

        // Verify consumer is ready to receive data
        const isReady = !consumer.paused && 
                       consumer.track.readyState === 'live' && 
                       !consumer.track.muted &&
                       recvTransport.connectionState === 'connected';
        
        if (!isReady) {
            console.warn('⚠️ Consumer not fully ready:', {
                paused: consumer.paused,
                trackState: consumer.track.readyState,
                trackMuted: consumer.track.muted,
                transportState: recvTransport.connectionState
            });
            console.warn('Video may not display correctly');
        }

        // Display remote video/audio
        if (kind === 'video') {
            console.log('Displaying remote video track for:', remotePeerId);
            displayRemoteVideo(remotePeerId, consumer.track);
        } else if (kind === 'audio') {
            console.log('Attaching remote audio track for:', remotePeerId);
            attachRemoteAudio(remotePeerId, consumer.track);
        }
    } catch (error) {
        console.error('Error consuming producer:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            remotePeerId,
            producerId,
            kind
        });
    }
}

function displayLocalVideo() {
    const container = document.getElementById('videosContainer');
    
    // Check if local video already exists
    const existingLocalVideo = document.getElementById(`video-${peerId}`);
    if (existingLocalVideo) {
        console.log('Local video already displayed');
        return;
    }
    
    // Don't clear container - preserve existing remote videos
    // Only clear if container is empty (initial state)
    if (container.children.length === 0 || container.querySelector('.empty-state')) {
        container.innerHTML = '';
    }

    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper local';
    videoWrapper.id = `video-${peerId}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = localStream;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `${peerId} (You)`;

    videoWrapper.appendChild(video);
    videoWrapper.appendChild(label);
    container.appendChild(videoWrapper);
    
    console.log('Local video displayed:', peerId);
}

function displayRemoteVideo(remotePeerId, track) {
    console.log('🔄 Displaying remote video for:', remotePeerId, 'Track state:', track.readyState);
    
    // CRITICAL: Validate track before proceeding
    if (!track) {
        console.error('❌ No track provided for:', remotePeerId);
        return;
    }
    
    if (track.readyState === 'ended') {
        console.error('❌ Track already ended for:', remotePeerId);
        return;
    }
    
    const container = document.getElementById('videosContainer');
    if (!container) {
        console.error('❌ Videos container not found');
        return;
    }
    
    // Check if video already exists for this peer
    let videoElement = remoteVideos.get(remotePeerId);
    let videoWrapper = document.getElementById(`video-${remotePeerId}`);
    
    if (videoElement && videoWrapper) {
        console.log('🔄 Updating existing remote video for:', remotePeerId);
        // Update existing video with new track
        const stream = new MediaStream([track]);
        videoElement.srcObject = stream;
        
        // Ensure video plays
        videoElement.play().catch(err => {
            console.error('❌ Error playing existing remote video:', err);
            // Retry after delay
            setTimeout(() => {
                videoElement.play().catch(retryErr => {
                    console.error('❌ Retry play failed:', retryErr);
                });
            }, 1000);
        });
        return;
    }
    
    // Create new video element
    videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    videoWrapper.id = `video-${remotePeerId}`;

    videoElement = document.createElement('video');
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.muted = false; // Unmute remote video
    
    // CRITICAL: Create MediaStream with the track
    const stream = new MediaStream([track]);
    videoElement.srcObject = stream;
    
    // CRITICAL: Add comprehensive event listeners for debugging
    videoElement.addEventListener('loadedmetadata', () => {
        console.log('✅ Remote video metadata loaded for:', remotePeerId);
        console.log('   Video dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
    });
    
    videoElement.addEventListener('loadeddata', () => {
        console.log('✅ Remote video data loaded for:', remotePeerId);
    });
    
    videoElement.addEventListener('canplay', () => {
        console.log('✅ Remote video can play for:', remotePeerId);
    });
    
    videoElement.addEventListener('playing', () => {
        console.log('✅ Remote video is playing for:', remotePeerId);
    });
    
    videoElement.addEventListener('play', () => {
        console.log('✅ Remote video started playing for:', remotePeerId);
    });
    
    videoElement.addEventListener('pause', () => {
        console.warn('⚠️ Remote video paused for:', remotePeerId);
    });
    
    videoElement.addEventListener('error', (e) => {
        console.error('❌ Remote video error for:', remotePeerId);
        console.error('   Error code:', videoElement.error?.code);
        console.error('   Error message:', videoElement.error?.message);
        console.error('   Error details:', e);
    });
    
    videoElement.addEventListener('stalled', () => {
        console.warn('⚠️ Remote video stalled for:', remotePeerId);
    });
    
    videoElement.addEventListener('waiting', () => {
        console.warn('⚠️ Remote video waiting for data:', remotePeerId);
    });
    
    // Monitor track state changes
    const trackStateHandler = () => {
        console.log(`Track state changed for ${remotePeerId}:`, track.readyState);
        if (track.readyState === 'ended') {
            console.warn('⚠️ Track ended for:', remotePeerId);
        }
    };
    
    track.addEventListener('ended', () => {
        console.warn('⚠️ Track ended event for:', remotePeerId);
        trackStateHandler();
    });
    
    track.addEventListener('mute', () => {
        console.log('Track muted for:', remotePeerId);
    });
    
    track.addEventListener('unmute', () => {
        console.log('Track unmuted for:', remotePeerId);
    });
    
    // CRITICAL: Explicit play() call with comprehensive error handling
    const playVideo = async () => {
        try {
            await videoElement.play();
            console.log('✅ Video play() succeeded for:', remotePeerId);
        } catch (error) {
            console.error('❌ Video play() failed for:', remotePeerId, error);
            console.error('   Error name:', error.name);
            console.error('   Error message:', error.message);
            
            // Handle different error types
            if (error.name === 'NotAllowedError') {
                console.warn('⚠️ Autoplay blocked by browser policy');
                console.warn('   Video will play after user interaction');
                // Add click handler to play on user interaction
                const playOnInteraction = () => {
                    videoElement.play().catch(e => console.error('Play on interaction failed:', e));
                    document.removeEventListener('click', playOnInteraction);
                    document.removeEventListener('touchstart', playOnInteraction);
                };
                document.addEventListener('click', playOnInteraction, { once: true });
                document.addEventListener('touchstart', playOnInteraction, { once: true });
            } else {
                // Retry after delay for other errors
                console.log('🔄 Retrying video play() after 1 second...');
                setTimeout(async () => {
                    try {
                        await videoElement.play();
                        console.log('✅ Video play() retry succeeded for:', remotePeerId);
                    } catch (retryError) {
                        console.error('❌ Video play() retry failed for:', remotePeerId, retryError);
                        // Final retry after longer delay
                        setTimeout(async () => {
                            try {
                                await videoElement.play();
                                console.log('✅ Video play() final retry succeeded for:', remotePeerId);
                            } catch (finalError) {
                                console.error('❌ Video play() final retry failed:', finalError);
                            }
                        }, 2000);
                    }
                }, 1000);
            }
        }
    };
    
    // Wait for track to be ready, then play
    if (track.readyState === 'live') {
        // Track is ready, play immediately
        setTimeout(playVideo, 100); // Small delay to ensure DOM is ready
    } else {
        // Wait for track to become live
        const trackStartedHandler = () => {
            console.log('✅ Track started for:', remotePeerId);
            playVideo();
        };
        
        track.addEventListener('started', trackStartedHandler, { once: true });
        
        // Fallback: try playing after delay even if 'started' event doesn't fire
        setTimeout(() => {
            if (track.readyState === 'live' && videoElement.paused) {
                console.log('🔄 Fallback: Attempting to play video...');
                playVideo();
            }
        }, 500);
    }

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = remotePeerId;

    videoWrapper.appendChild(videoElement);
    videoWrapper.appendChild(label);
    container.appendChild(videoWrapper);

    remoteVideos.set(remotePeerId, videoElement);
    console.log('✅ Remote video element created and attached for:', remotePeerId);
}

function attachRemoteAudio(remotePeerId, track) {
    let audio = document.getElementById(`audio-${remotePeerId}`);
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${remotePeerId}`;
        audio.autoplay = true;
        document.body.appendChild(audio);
    }
    audio.srcObject = new MediaStream([track]);
}

function removeRemoteVideo(remotePeerId) {
    const videoWrapper = document.getElementById(`video-${remotePeerId}`);
    if (videoWrapper) {
        videoWrapper.remove();
    }
    
    const audio = document.getElementById(`audio-${remotePeerId}`);
    if (audio) {
        audio.remove();
    }

    remoteVideos.delete(remotePeerId);

    // Remove consumers
    for (const [consumerId, { peerId: pId }] of consumers) {
        if (pId === remotePeerId) {
            consumers.delete(consumerId);
        }
    }

    // Show empty state if no videos
    const container = document.getElementById('videosContainer');
    if (container.children.length === 0) {
        container.innerHTML = '<div class="empty-state"><h2>No active participants</h2><p>Waiting for others to join...</p></div>';
    }
}

function toggleVideo() {
    const videoProducer = producers.get('video');
    if (videoProducer) {
        if (videoProducer.paused) {
            videoProducer.resume();
        } else {
            videoProducer.pause();
        }
    }
}

function toggleAudio() {
    const audioProducer = producers.get('audio');
    if (audioProducer) {
        if (audioProducer.paused) {
            audioProducer.resume();
        } else {
            audioProducer.pause();
        }
    }
}

async function leaveRoom() {
    try {
        // Stop all tracks
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        // Close producers
        for (const producer of producers.values()) {
            producer.close();
        }
        producers.clear();

        // Close consumers
        for (const { consumer } of consumers.values()) {
            consumer.close();
        }
        consumers.clear();

        // Close transports
        if (sendTransport) {
            sendTransport.close();
            sendTransport = null;
        }
        if (recvTransport) {
            recvTransport.close();
            recvTransport = null;
        }

        // Disconnect socket
        if (socket) {
            socket.disconnect();
            socket = null;
        }

        // Clear videos
        document.getElementById('videosContainer').innerHTML = '<div class="empty-state"><h2>No active participants</h2><p>Join a room to start video calling</p></div>';
        remoteVideos.clear();

        // Update UI
        document.getElementById('joinBtn').disabled = false;
        document.getElementById('leaveBtn').disabled = true;
        document.getElementById('toggleVideoBtn').disabled = true;
        document.getElementById('toggleAudioBtn').disabled = true;
        document.getElementById('roomIdInput').disabled = false;
        document.getElementById('peerIdInput').disabled = false;

        updateStatus('Disconnected', false);
        console.log('Left room');
    } catch (error) {
        console.error('Error leaving room:', error);
    }
}

/**
 * Debug helper: Check state of all video elements and consumers
 * Call this from browser console: checkVideoState()
 */
function checkVideoState() {
    console.log('=== VIDEO STATE DEBUG ===');
    
    // Check consumers
    console.log('\n📹 Consumers:');
    consumers.forEach(({ consumer, peerId, kind }) => {
        console.log(`  ${kind} from ${peerId}:`, {
            id: consumer.id,
            producerId: consumer.producerId,
            trackState: consumer.track.readyState,
            trackEnabled: consumer.track.enabled,
            trackMuted: consumer.track.muted,
            paused: consumer.paused
        });
    });
    
    // Check remote videos
    console.log('\n🎥 Remote Video Elements:');
    remoteVideos.forEach((video, peerId) => {
        const wrapper = document.getElementById(`video-${peerId}`);
        console.log(`  ${peerId}:`, {
            exists: !!video,
            wrapperExists: !!wrapper,
            srcObject: !!video.srcObject,
            paused: video.paused,
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            error: video.error,
            tracks: video.srcObject ? video.srcObject.getTracks().map(t => ({
                id: t.id,
                kind: t.kind,
                readyState: t.readyState,
                enabled: t.enabled,
                muted: t.muted
            })) : []
        });
    });
    
    // Check all video elements in DOM
    console.log('\n📺 All Video Elements in DOM:');
    document.querySelectorAll('video').forEach((video, index) => {
        console.log(`  Video ${index}:`, {
            id: video.id,
            parentId: video.parentElement?.id,
            srcObject: !!video.srcObject,
            paused: video.paused,
            muted: video.muted,
            autoplay: video.autoplay,
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            error: video.error
        });
    });
    
    console.log('\n=== END DEBUG ===');
}

// Make it available globally for console debugging
window.checkVideoState = checkVideoState;

// Attach event listeners
function attachEventListeners() {
    document.getElementById('joinBtn').addEventListener('click', joinRoom);
    document.getElementById('leaveBtn').addEventListener('click', leaveRoom);
    document.getElementById('toggleVideoBtn').addEventListener('click', toggleVideo);
    document.getElementById('toggleAudioBtn').addEventListener('click', toggleAudio);
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    // Disable join button until initialization is complete
    const joinBtn = document.getElementById('joinBtn');
    if (joinBtn) {
        joinBtn.disabled = true;
    }
    
    // Check media device support early and show warnings
    const isSupported = checkMediaDeviceSupport();
    
    if (!isSupported) {
        console.warn('Media device support issues detected. Some features may not work.');
        // Don't block initialization, but log warnings
    }
    
    attachEventListeners();
    
    // Initialize and wait for it to complete
    try {
        await init();
    } catch (error) {
        console.error('Failed to initialize:', error);
        updateStatus('Initialization failed', false);
        
        // Show error if it's a critical issue
        if (error.message && error.message.includes('HTTPS')) {
            alert(error.message);
        }
    }
});


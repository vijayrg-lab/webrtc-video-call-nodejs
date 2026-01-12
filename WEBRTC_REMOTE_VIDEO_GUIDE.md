# Complete Guide: Remote Video Not Displaying in WebRTC

## Understanding Your Architecture

**Important**: Your app uses **MediaSoup (SFU architecture)**, NOT standard peer-to-peer WebRTC.

### MediaSoup vs Standard WebRTC

| Aspect | Standard WebRTC | MediaSoup (Your App) |
|--------|----------------|---------------------|
| Connection | Direct peer-to-peer | Via SFU server |
| Tracks | `addTrack()` / `ontrack` event | `produce()` / `consume()` |
| SDP | Manual offer/answer | Handled by MediaSoup |
| Transports | Single PeerConnection | Separate send/recv transports |

## Common Reasons Remote Video Doesn't Display

### 1. **Track Not Ready When Attached** ⚠️ CRITICAL
**Problem**: Track is attached to video element before it's ready to play.

**Symptoms**:
- Video element created but black screen
- Track state is 'live' but no video
- Console shows track but video doesn't play

**Fix**: Wait for track to be ready, then attach and play.

### 2. **Video Element Not Playing** ⚠️ CRITICAL
**Problem**: Relying only on `autoplay` attribute doesn't work in all browsers.

**Symptoms**:
- Video element exists but doesn't play
- Works in some browsers, not others
- Mobile browsers especially affected

**Fix**: Explicitly call `video.play()` with error handling.

### 3. **Consumer Not Resumed** ⚠️ CRITICAL
**Problem**: Consumer is created but not resumed, so no data flows.

**Symptoms**:
- Consumer created successfully
- Track exists but no data
- Track state stays 'live' but empty

**Fix**: Ensure `consumer.resume()` is called after creation.

### 4. **Receive Transport Not Connected**
**Problem**: Consuming before receive transport is connected.

**Symptoms**:
- Consumer creation fails
- "Transport not ready" errors
- Track never received

**Fix**: Wait for receive transport connection before consuming.

### 5. **Track Ended Before Display**
**Problem**: Track ends between creation and display.

**Symptoms**:
- Track state is 'ended'
- Video element created but no track
- Works sometimes, fails other times

**Fix**: Check track state before attaching, handle ended tracks.

### 6. **Container Cleared**
**Problem**: Container cleared after remote video is added.

**Symptoms**:
- Video appears briefly then disappears
- Works when one user joins, breaks when second joins

**Fix**: Don't clear container if remote videos exist.

## MediaSoup Pattern (Your Current Implementation)

### Correct Flow

```javascript
// 1. Get local media
const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

// 2. Create MediaSoup device and load router capabilities
const device = new mediasoupClient.Device();
await device.load({ routerRtpCapabilities });

// 3. Create send transport and produce local track
const sendTransport = device.createSendTransport({...});
const producer = await sendTransport.produce({ track: localStream.getVideoTracks()[0] });

// 4. Create receive transport
const recvTransport = device.createRecvTransport({...});

// 5. When remote producer is available, consume it
const consumer = await recvTransport.consume({
    id: consumerId,
    producerId: remoteProducerId,
    kind: 'video',
    rtpParameters: rtpParameters
});

// 6. Resume consumer to start receiving data
await consumer.resume();

// 7. Attach track to video element
const stream = new MediaStream([consumer.track]);
videoElement.srcObject = stream;
await videoElement.play(); // CRITICAL: Explicit play()
```

## Standard WebRTC Pattern (For Comparison)

### Correct Flow

```javascript
// 1. Create RTCPeerConnection
const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

// 2. Handle incoming tracks (CRITICAL!)
pc.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind);
    
    // CRITICAL: Create new MediaStream with the track
    const remoteStream = new MediaStream([event.track]);
    
    // CRITICAL: Attach to video element
    const videoElement = document.getElementById('remoteVideo');
    videoElement.srcObject = remoteStream;
    
    // CRITICAL: Explicit play (autoplay doesn't always work)
    videoElement.play().catch(err => {
        console.error('Error playing video:', err);
    });
};

// 3. Add local tracks
localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
});

// 4. Create offer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

// 5. Send offer to remote peer (via signaling)
// 6. Receive answer, set remote description
await pc.setRemoteDescription(answer);

// 7. Handle ICE candidates
pc.onicecandidate = (event) => {
    if (event.candidate) {
        // Send candidate to remote peer
    }
};
```

## Fixed Code for Your MediaSoup Implementation

### Fixed `displayRemoteVideo()` Function

```javascript
function displayRemoteVideo(remotePeerId, track) {
    console.log('Displaying remote video for:', remotePeerId, 'Track state:', track.readyState);
    
    // CRITICAL: Validate track before proceeding
    if (!track) {
        console.error('No track provided for:', remotePeerId);
        return;
    }
    
    if (track.readyState === 'ended') {
        console.error('Track already ended for:', remotePeerId);
        return;
    }
    
    const container = document.getElementById('videosContainer');
    if (!container) {
        console.error('Videos container not found');
        return;
    }
    
    // Check if video already exists
    let videoElement = remoteVideos.get(remotePeerId);
    let videoWrapper = document.getElementById(`video-${remotePeerId}`);
    
    if (!videoElement || !videoWrapper) {
        // Create new video element
        videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-wrapper';
        videoWrapper.id = `video-${remotePeerId}`;
        
        videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.muted = false; // Unmute remote video
        
        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = remotePeerId;
        
        videoWrapper.appendChild(videoElement);
        videoWrapper.appendChild(label);
        container.appendChild(videoWrapper);
        
        remoteVideos.set(remotePeerId, videoElement);
    }
    
    // CRITICAL: Create MediaStream with the track
    const stream = new MediaStream([track]);
    videoElement.srcObject = stream;
    
    // CRITICAL: Add event listeners for debugging
    videoElement.addEventListener('loadedmetadata', () => {
        console.log('Remote video metadata loaded for:', remotePeerId);
        console.log('Video dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
    });
    
    videoElement.addEventListener('loadeddata', () => {
        console.log('Remote video data loaded for:', remotePeerId);
    });
    
    videoElement.addEventListener('canplay', () => {
        console.log('Remote video can play for:', remotePeerId);
    });
    
    videoElement.addEventListener('play', () => {
        console.log('✅ Remote video started playing for:', remotePeerId);
    });
    
    videoElement.addEventListener('pause', () => {
        console.warn('Remote video paused for:', remotePeerId);
    });
    
    videoElement.addEventListener('error', (e) => {
        console.error('❌ Remote video error for:', remotePeerId, e);
        console.error('Error code:', videoElement.error?.code);
        console.error('Error message:', videoElement.error?.message);
    });
    
    // CRITICAL: Explicit play() call with retry logic
    const playVideo = async () => {
        try {
            await videoElement.play();
            console.log('✅ Video play() succeeded for:', remotePeerId);
        } catch (error) {
            console.error('❌ Video play() failed for:', remotePeerId, error);
            
            // Retry after user interaction or delay
            if (error.name === 'NotAllowedError') {
                console.warn('Autoplay blocked, video will play after user interaction');
                // Video will play when user interacts with page
            } else {
                // Retry after delay
                setTimeout(async () => {
                    try {
                        await videoElement.play();
                        console.log('✅ Video play() retry succeeded for:', remotePeerId);
                    } catch (retryError) {
                        console.error('❌ Video play() retry failed for:', remotePeerId, retryError);
                    }
                }, 1000);
            }
        }
    };
    
    // Wait a bit for track to be ready, then play
    if (track.readyState === 'live') {
        playVideo();
    } else {
        // Wait for track to become live
        track.addEventListener('started', () => {
            console.log('Track started for:', remotePeerId);
            playVideo();
        }, { once: true });
        
        // Fallback: try playing after delay
        setTimeout(() => {
            if (track.readyState === 'live') {
                playVideo();
            }
        }, 500);
    }
    
    // Monitor track state
    const checkTrackState = () => {
        console.log(`Track state for ${remotePeerId}:`, track.readyState);
        if (track.readyState === 'ended') {
            console.warn('Track ended for:', remotePeerId);
        }
    };
    
    track.addEventListener('ended', () => {
        console.warn('Track ended event for:', remotePeerId);
        checkTrackState();
    });
    
    track.addEventListener('mute', () => {
        console.log('Track muted for:', remotePeerId);
    });
    
    track.addEventListener('unmute', () => {
        console.log('Track unmuted for:', remotePeerId);
    });
}
```

### Fixed `consumeProducer()` Function

```javascript
async function consumeProducer(remotePeerId, producerId, kind) {
    try {
        console.log(`🔄 Consuming ${kind} producer:`, { remotePeerId, producerId });
        
        // Validate prerequisites
        if (!socket || !socket.connected) {
            console.error('❌ Socket not connected');
            return;
        }
        
        if (!recvTransport || !device) {
            console.error('❌ Transport or device not initialized');
            return;
        }
        
        // CRITICAL: Ensure receive transport is connected
        if (recvTransport.connectionState !== 'connected') {
            console.log('⏳ Waiting for receive transport to connect...');
            let waitCount = 0;
            while (recvTransport.connectionState !== 'connected' && waitCount < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
            
            if (recvTransport.connectionState !== 'connected') {
                console.warn('⚠️ Receive transport not connected, but proceeding');
            } else {
                console.log('✅ Receive transport connected');
            }
        }
        
        // Request consumer from server
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
                    console.error('❌ Consume error:', response.error);
                    reject(new Error(response.error));
                } else {
                    console.log('✅ Consume response received:', response.id);
                    resolve(response);
                }
            });
        });
        
        // Create consumer
        console.log('🔄 Creating consumer...');
        const consumer = await recvTransport.consume({
            id: response.id,
            producerId: response.producerId,
            kind: response.kind,
            rtpParameters: response.rtpParameters,
        });
        
        console.log('✅ Consumer created:', {
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            trackState: consumer.track.readyState,
            trackEnabled: consumer.track.enabled,
            trackMuted: consumer.track.muted
        });
        
        // Store consumer
        consumers.set(consumer.id, { consumer, peerId: remotePeerId, kind });
        
        // CRITICAL: Add track event listeners
        consumer.track.addEventListener('ended', () => {
            console.warn('⚠️ Consumer track ended:', consumer.id);
        });
        
        consumer.track.addEventListener('started', () => {
            console.log('✅ Consumer track started:', consumer.id);
        });
        
        // CRITICAL: Resume consumer to start receiving data
        console.log('🔄 Resuming consumer...');
        await new Promise((resolve, reject) => {
            socket.emit('resume-consumer', { consumerId: consumer.id }, (response) => {
                if (response && response.error) {
                    console.error('❌ Resume error:', response.error);
                    reject(new Error(response.error));
                } else {
                    console.log('✅ Consumer resumed:', consumer.id);
                    resolve();
                }
            });
        });
        
        // CRITICAL: Wait for track to be ready
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verify track is ready
        console.log('Track ready state after resume:', consumer.track.readyState);
        if (consumer.track.readyState !== 'live') {
            console.warn('⚠️ Track not live after resume, state:', consumer.track.readyState);
        }
        
        // Display remote video/audio
        if (kind === 'video') {
            console.log('🔄 Displaying remote video...');
            displayRemoteVideo(remotePeerId, consumer.track);
        } else if (kind === 'audio') {
            console.log('🔄 Attaching remote audio...');
            attachRemoteAudio(remotePeerId, consumer.track);
        }
        
    } catch (error) {
        console.error('❌ Error consuming producer:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            remotePeerId,
            producerId,
            kind
        });
    }
}
```

## Debugging Checklist

### Step 1: Check Consumer Creation
```javascript
// In browser console, check:
console.log('Consumers:', Array.from(consumers.values()));
console.log('Remote videos:', Array.from(remoteVideos.keys()));
```

### Step 2: Check Track State
```javascript
// For each consumer:
consumers.forEach(({ consumer, peerId }) => {
    console.log(`Consumer ${peerId}:`, {
        id: consumer.id,
        trackState: consumer.track.readyState,
        trackEnabled: consumer.track.enabled,
        trackMuted: consumer.track.muted,
        trackKind: consumer.track.kind
    });
});
```

### Step 3: Check Video Elements
```javascript
// Check all video elements:
document.querySelectorAll('video').forEach((video, index) => {
    console.log(`Video ${index}:`, {
        srcObject: video.srcObject,
        paused: video.paused,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        error: video.error
    });
});
```

### Step 4: Check Network
- Open Chrome DevTools → Network tab
- Filter by "Media" or "WebRTC"
- Check if RTP packets are being received

### Step 5: Check Console Logs
Look for these messages:
- ✅ "Consumer created"
- ✅ "Consumer resumed"
- ✅ "Displaying remote video"
- ✅ "Remote video started playing"

## Browser-Specific Issues

### Chrome/Edge
- **Autoplay Policy**: May block autoplay, requires user interaction
- **Fix**: Explicit `play()` call, handle `NotAllowedError`

### Firefox
- **Track Attachment**: May need delay before attaching track
- **Fix**: Wait 100-200ms after consumer creation

### Safari (iOS)
- **PlaysInline Required**: Must have `playsInline` attribute
- **User Interaction**: May require user interaction to play
- **Fix**: Ensure `playsInline` is set, handle play() errors

## Complete Working Example

See the fixed code in `public/client.js`:
- `consumeProducer()` - Lines 1284-1401
- `displayRemoteVideo()` - Lines 1441-1520

## Quick Fix Summary

1. ✅ Wait for receive transport connection
2. ✅ Resume consumer after creation
3. ✅ Wait for track to be ready (200ms delay)
4. ✅ Create MediaStream with track
5. ✅ Attach to video element
6. ✅ Explicitly call `video.play()`
7. ✅ Handle play() errors with retry
8. ✅ Add event listeners for debugging
9. ✅ Don't clear container if remote videos exist

## Testing

1. Open two browser windows
2. Join same room from both
3. Check console for:
   - "Consumer created"
   - "Consumer resumed"
   - "Remote video started playing"
4. Verify both users see each other's video

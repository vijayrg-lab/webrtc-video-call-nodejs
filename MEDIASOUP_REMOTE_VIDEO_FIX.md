# MediaSoup Remote Video Black Screen - Complete Fix Guide

## Problem Analysis

### Symptoms
- ✅ Video element created and attached
- ✅ `play()` called successfully  
- ✅ Track state: `live`
- ❌ **Black screen (no video frames)**
- ⚠️ "Remote video waiting for data"
- ⚠️ "Consumer track muted"
- ❌ **"Receive transport connection state: disconnected"**

### Root Causes

#### 1. **Receive Transport Disconnected** (PRIMARY ISSUE)
- **Impact**: No data can flow if transport is disconnected
- **Why**: Transport must be `connected` for consumers to receive data
- **Fix**: Ensure transport connects before consuming, and handle reconnection

#### 2. **Consumer Not Resumed**
- **Impact**: Consumer is paused by default in MediaSoup
- **Why**: MediaSoup pauses consumers initially to save bandwidth
- **Fix**: Must call `consumer.resume()` AND emit `resume-consumer` to server

#### 3. **Track Muted**
- **Impact**: Even if consumer is resumed, track can be muted
- **Why**: Track can be muted if producer pauses or transport issues
- **Fix**: Check `track.muted` and handle `unmute` events

#### 4. **Consumer Paused State**
- **Impact**: Consumer might still be paused after resume
- **Why**: Resume might fail silently or transport issues prevent resume
- **Fix**: Verify `consumer.paused === false` after resume

## Understanding MediaSoup Consumer States

### Consumer Lifecycle
```
1. Create consumer → consumer.paused = true (default)
2. Call consumer.resume() → consumer.paused = false
3. Emit 'resume-consumer' to server → Server calls consumer.resume()
4. Track becomes active → track.readyState = 'live'
5. Data flows → Video frames appear
```

### Track States
- `live` - Track is active and can receive data
- `ended` - Track has ended (producer stopped)
- `muted` - Track is muted (no data flowing)
- `unmuted` - Track is unmuted (data flowing)

### Transport States
- `new` - Transport created but not connected
- `connecting` - Transport is connecting
- `connected` - Transport is connected (REQUIRED for data flow)
- `failed` - Transport connection failed
- `disconnected` - Transport lost connection

## The Fix

### Step 1: Ensure Transport is Connected

**Before consuming**, verify transport is connected:

```javascript
// Wait for transport to be connected
if (recvTransport.connectionState !== 'connected') {
    console.log('⏳ Waiting for receive transport to connect...');
    
    // Wait up to 10 seconds
    let waitCount = 0;
    while (recvTransport.connectionState !== 'connected' && waitCount < 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
    }
    
    if (recvTransport.connectionState !== 'connected') {
        console.error('❌ Receive transport not connected - cannot consume');
        // Try to reconnect transport
        await reconnectReceiveTransport();
        return;
    }
}
```

### Step 2: Create Consumer Properly

```javascript
const consumer = await recvTransport.consume({
    id: response.id,
    producerId: response.producerId,
    kind: response.kind,
    rtpParameters: response.rtpParameters,
});

console.log('Consumer created:', {
    id: consumer.id,
    paused: consumer.paused,  // Should be true initially
    trackState: consumer.track.readyState,
    trackMuted: consumer.track.muted
});
```

### Step 3: Resume Consumer (CRITICAL)

```javascript
// CRITICAL: Resume consumer to start receiving data
// MediaSoup pauses consumers by default
if (consumer.paused) {
    console.log('Resuming paused consumer:', consumer.id);
    
    // Call client-side resume
    consumer.resume();
    
    // Notify server to resume
    await new Promise((resolve, reject) => {
        socket.emit('resume-consumer', { consumerId: consumer.id }, (response) => {
            if (response && response.error) {
                console.error('❌ Resume consumer error:', response.error);
                reject(new Error(response.error));
            } else {
                console.log('✅ Consumer resumed on server');
                resolve();
            }
        });
    });
    
    // Verify consumer is not paused
    if (consumer.paused) {
        console.error('❌ Consumer still paused after resume!');
        // Retry resume
        consumer.resume();
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log('Consumer state after resume:', {
        paused: consumer.paused,  // Should be false
        trackMuted: consumer.track.muted
    });
}
```

### Step 4: Handle Track Muted State

```javascript
// Check if track is muted
if (consumer.track.muted) {
    console.warn('⚠️ Track is muted - waiting for unmute...');
    
    // Wait for unmute event
    await new Promise((resolve) => {
        const unmuteHandler = () => {
            console.log('✅ Track unmuted');
            consumer.track.removeEventListener('unmute', unmuteHandler);
            resolve();
        };
        consumer.track.addEventListener('unmute', unmuteHandler);
        
        // Timeout after 5 seconds
        setTimeout(() => {
            consumer.track.removeEventListener('unmute', unmuteHandler);
            console.warn('⚠️ Track unmute timeout - proceeding anyway');
            resolve();
        }, 5000);
    });
}
```

### Step 5: Monitor Transport State Changes

```javascript
// Monitor transport state changes
recvTransport.on('connectionstatechange', (state) => {
    console.log('Receive transport state:', state);
    
    if (state === 'disconnected' || state === 'failed') {
        console.error('❌ Receive transport disconnected - remote video will stop');
        
        // Try to reconnect
        reconnectReceiveTransport();
    } else if (state === 'connected') {
        console.log('✅ Receive transport reconnected');
        
        // Resume all paused consumers
        consumers.forEach(({ consumer }) => {
            if (consumer.paused) {
                console.log('Resuming consumer after transport reconnect:', consumer.id);
                consumer.resume();
                socket.emit('resume-consumer', { consumerId: consumer.id });
            }
        });
    }
});
```

### Step 6: Verify Consumer State Before Displaying

```javascript
// Before displaying video, verify consumer is ready
function isConsumerReady(consumer) {
    return (
        !consumer.paused &&                    // Consumer is not paused
        consumer.track.readyState === 'live' && // Track is live
        !consumer.track.muted &&              // Track is not muted
        recvTransport.connectionState === 'connected' // Transport is connected
    );
}

// Check before displaying
if (!isConsumerReady(consumer)) {
    console.warn('⚠️ Consumer not ready:', {
        paused: consumer.paused,
        trackState: consumer.track.readyState,
        trackMuted: consumer.track.muted,
        transportState: recvTransport.connectionState
    });
    
    // Wait for consumer to be ready
    await waitForConsumerReady(consumer);
}
```

## Complete Fixed Code

See the updated `consumeProducer()` function in `client.js` for the complete implementation.

## Checklist to Fix Black Remote Video

- [ ] **Receive transport is connected** (`recvTransport.connectionState === 'connected'`)
- [ ] **Consumer is created** (`consumer` exists)
- [ ] **Consumer is resumed** (`consumer.paused === false`)
- [ ] **Server resume called** (`socket.emit('resume-consumer')` succeeded)
- [ ] **Track is live** (`consumer.track.readyState === 'live'`)
- [ ] **Track is not muted** (`consumer.track.muted === false`)
- [ ] **Video element attached** (`video.srcObject` is set)
- [ ] **Video play() called** (`video.play()` succeeded)
- [ ] **Transport state monitored** (listening to `connectionstatechange`)

## Debugging Commands

Run in browser console:

```javascript
// Check consumer state
const consumer = Array.from(consumers.values())[0]?.consumer;
console.log('Consumer state:', {
    paused: consumer?.paused,
    trackState: consumer?.track.readyState,
    trackMuted: consumer?.track.muted,
    trackEnabled: consumer?.track.enabled
});

// Check transport state
console.log('Receive transport state:', recvTransport.connectionState);

// Check video element
const video = document.querySelector('video[srcObject]');
console.log('Video state:', {
    paused: video?.paused,
    readyState: video?.readyState,
    error: video?.error,
    srcObject: video?.srcObject
});

// Force resume consumer
if (consumer?.paused) {
    consumer.resume();
    socket.emit('resume-consumer', { consumerId: consumer.id });
}

// Force play video
video?.play();
```

## Common Issues & Solutions

### Issue 1: Transport Disconnected
**Solution**: Implement transport reconnection logic

### Issue 2: Consumer Still Paused After Resume
**Solution**: Verify `consumer.paused === false` and retry if needed

### Issue 3: Track Muted
**Solution**: Wait for `unmute` event or check producer state

### Issue 4: "Waiting for data"
**Solution**: Ensure transport connected + consumer resumed + track unmuted

## Browser Autoplay Issues

If video doesn't play due to autoplay policy:
- Add `playsinline` attribute
- Call `video.play()` explicitly
- Handle `NotAllowedError` and retry on user interaction

## Next Steps

1. Implement transport reconnection
2. Add consumer state verification
3. Handle track mute/unmute events
4. Add comprehensive logging
5. Test with multiple peers

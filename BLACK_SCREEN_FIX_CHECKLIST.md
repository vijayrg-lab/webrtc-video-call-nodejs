# Black Screen Fix Checklist - Quick Reference

## Problem: Remote Video Black Screen

**Symptoms:**
- ✅ Video element created
- ✅ `play()` succeeds
- ✅ Track state: `live`
- ❌ **Black screen (no frames)**
- ⚠️ "Waiting for data"
- ⚠️ "Consumer track muted"
- ❌ **"Receive transport disconnected"**

## Root Causes (In Order of Likelihood)

### 1. ❌ Receive Transport Disconnected (MOST COMMON)
**Impact:** No data can flow if transport is disconnected
**Fix:** Ensure transport is `connected` before consuming

### 2. ⚠️ Consumer Not Resumed
**Impact:** Consumer paused = no data received
**Fix:** Call `consumer.resume()` + emit `resume-consumer` to server

### 3. ⚠️ Track Muted
**Impact:** Track muted = no frames even if consumer resumed
**Fix:** Wait for `unmute` event or check producer state

### 4. ⚠️ Consumer Still Paused After Resume
**Impact:** Resume failed silently
**Fix:** Verify `consumer.paused === false` after resume

## Quick Fix Checklist

Run through this checklist when remote video is black:

### Step 1: Check Transport State
```javascript
// In browser console
console.log('Transport state:', recvTransport.connectionState);
// Must be 'connected' for video to work
```

**If disconnected/failed:**
- Check network connection
- Check firewall settings
- Refresh page
- Check server logs

### Step 2: Check Consumer State
```javascript
// In browser console
const consumer = Array.from(consumers.values())[0]?.consumer;
console.log('Consumer:', {
    paused: consumer?.paused,  // Must be false
    trackState: consumer?.track.readyState,  // Must be 'live'
    trackMuted: consumer?.track.muted  // Must be false
});
```

**If paused:**
```javascript
consumer.resume();
socket.emit('resume-consumer', { consumerId: consumer.id });
```

**If muted:**
- Wait for unmute event
- Check if producer is paused
- Check transport state

### Step 3: Check Video Element
```javascript
// In browser console
const video = document.querySelector('video[srcObject]');
console.log('Video:', {
    paused: video?.paused,  // Should be false
    readyState: video?.readyState,  // Should be 4
    error: video?.error,
    srcObject: video?.srcObject
});
```

**If paused:**
```javascript
video.play();
```

**If no srcObject:**
- Track not attached properly
- Check `displayRemoteVideo()` function

## Code Fixes Applied

### ✅ Transport State Check
- Now waits up to 10 seconds for transport to connect
- Throws error if transport fails/disconnects
- Handles `disconnected` state properly

### ✅ Consumer Resume Logic
- Verifies transport is connected before resuming
- Calls `consumer.resume()` (client-side)
- Emits `resume-consumer` to server (REQUIRED)
- Verifies consumer is not paused after resume
- Retries if consumer still paused

### ✅ Track Muted Handling
- Checks if track is muted after resume
- Waits for `unmute` event (3 second timeout)
- Logs warnings if track remains muted

### ✅ Transport Reconnection
- Automatically resumes consumers when transport reconnects
- Handles `connectionstatechange` events
- Resumes all paused consumers on reconnect

## Expected Console Output (Success)

```
📊 Receive transport state before consume: connected
✅ Receive transport already connected
Consume response received for video: abc123
Consumer created: abc123 Track state: live
Consumer state before resume: { paused: true, trackState: 'live', trackMuted: false, transportState: 'connected' }
🔄 Resuming paused consumer: abc123
✅ Consumer resumed on server: abc123
Consumer state after resume: { paused: false, trackState: 'live', trackMuted: false, transportState: 'connected' }
Displaying remote video track for: peer-123
✅ Video play() succeeded for: peer-123
```

## Debugging Commands

### Check Everything at Once
```javascript
// Run in browser console
function checkRemoteVideo() {
    const consumer = Array.from(consumers.values())[0]?.consumer;
    const video = document.querySelector('video[srcObject]');
    
    console.log('=== REMOTE VIDEO DIAGNOSTICS ===');
    console.log('Transport:', recvTransport.connectionState);
    console.log('Consumer:', {
        paused: consumer?.paused,
        trackState: consumer?.track.readyState,
        trackMuted: consumer?.track.muted
    });
    console.log('Video:', {
        paused: video?.paused,
        readyState: video?.readyState,
        error: video?.error
    });
    
    // Auto-fix common issues
    if (consumer?.paused) {
        console.log('🔧 Fixing: Resuming consumer...');
        consumer.resume();
        socket.emit('resume-consumer', { consumerId: consumer.id });
    }
    
    if (video?.paused) {
        console.log('🔧 Fixing: Playing video...');
        video.play();
    }
}

checkRemoteVideo();
```

### Force Resume All Consumers
```javascript
consumers.forEach(({ consumer }) => {
    if (consumer.paused) {
        consumer.resume();
        socket.emit('resume-consumer', { consumerId: consumer.id });
    }
});
```

### Force Play All Videos
```javascript
document.querySelectorAll('video').forEach(v => {
    if (v.paused) v.play();
});
```

## Common Issues & Solutions

### Issue: "Receive transport disconnected"
**Solution:** 
1. Check network connection
2. Check firewall
3. Refresh page
4. Check server logs

### Issue: "Consumer still paused after resume"
**Solution:**
1. Verify transport is connected
2. Check server logs for resume errors
3. Retry resume manually
4. Check if producer exists on server

### Issue: "Track muted"
**Solution:**
1. Wait for unmute event
2. Check if producer is paused
3. Check transport state
4. Verify producer is sending data

### Issue: "Waiting for data"
**Solution:**
1. Ensure transport connected
2. Ensure consumer resumed
3. Ensure track not muted
4. Check producer state

## Still Not Working?

1. **Check all console logs** - Look for error patterns
2. **Test with two browsers** - Is it one user or all?
3. **Check server logs** - Look for server-side errors
4. **Test network** - Try different network
5. **Check MediaSoup version** - Ensure compatibility

## Related Documentation

- `MEDIASOUP_REMOTE_VIDEO_FIX.md` - Detailed explanation
- `RECEIVE_TRANSPORT_TROUBLESHOOTING.md` - Transport issues
- `REMOTE_VIDEO_DEBUG_QUICK_REFERENCE.md` - General debugging

# Remote Video Debugging - Quick Reference

## Browser Console Commands

### Check Video State
```javascript
// Run this in browser console
checkVideoState()
```

### Manual Checks
```javascript
// Check consumers
console.log('Consumers:', Array.from(consumers.values()));

// Check remote videos
console.log('Remote videos:', Array.from(remoteVideos.keys()));

// Check video elements
document.querySelectorAll('video').forEach((v, i) => {
    console.log(`Video ${i}:`, {
        paused: v.paused,
        srcObject: v.srcObject,
        error: v.error,
        readyState: v.readyState
    });
});
```

## Common Issues & Quick Fixes

### Issue: Video element exists but black screen
**Check:**
```javascript
const video = document.querySelector('video[srcObject]');
console.log('Video state:', {
    paused: video.paused,
    readyState: video.readyState,
    error: video.error,
    trackState: video.srcObject?.getVideoTracks()[0]?.readyState
});
```

**Fix:** Call `video.play()` manually

### Issue: Track state is 'live' but no video
**Check:**
```javascript
const consumer = Array.from(consumers.values())[0]?.consumer;
console.log('Consumer:', {
    paused: consumer.paused,
    trackState: consumer.track.readyState,
    trackEnabled: consumer.track.enabled
});
```

**Fix:** Ensure consumer is resumed: `consumer.resume()`

### Issue: Video plays then stops
**Check:** Track ended event
**Fix:** Handle track ended, recreate consumer if needed

## Step-by-Step Debugging

1. **Check if consumer is created:**
   ```javascript
   console.log('Consumers count:', consumers.size);
   ```

2. **Check if track exists:**
   ```javascript
   consumers.forEach(({ consumer }) => {
       console.log('Track:', consumer.track.readyState);
   });
   ```

3. **Check if video element exists:**
   ```javascript
   console.log('Video elements:', document.querySelectorAll('video').length);
   ```

4. **Check if video is playing:**
   ```javascript
   document.querySelectorAll('video').forEach(v => {
       console.log('Playing:', !v.paused, 'Error:', v.error);
   });
   ```

5. **Force play video:**
   ```javascript
   document.querySelectorAll('video').forEach(v => {
       if (v.paused) v.play();
   });
   ```

## Expected Console Output (Success)

```
✅ Consuming video producer: { remotePeerId: 'peer-123', producerId: 'abc' }
✅ Receive transport connected
✅ Consume response received for video: xyz
✅ Consumer created: xyz Track state: live
✅ Consumer resumed: xyz
✅ Displaying remote video track for: peer-123
✅ Remote video metadata loaded for: peer-123
✅ Remote video can play for: peer-123
✅ Video play() succeeded for: peer-123
✅ Remote video started playing for: peer-123
```

## Error Patterns

### Pattern 1: Consumer Not Created
```
❌ Consume error: Producer not found
```
**Fix:** Check if producer exists on server

### Pattern 2: Track Not Ready
```
Track state: new
```
**Fix:** Wait for track to become 'live'

### Pattern 3: Video Not Playing
```
Error playing remote video: NotAllowedError
```
**Fix:** User interaction required, or handle autoplay policy

### Pattern 4: Track Ended
```
Track state: ended
```
**Fix:** Producer stopped, need to recreate consumer

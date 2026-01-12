# Receive Transport Connection Failure - Troubleshooting Guide

## Error Message
```
Receive transport connection failed
```

## What This Means

The receive transport is used to receive remote video/audio streams. When it fails to connect, you won't be able to see or hear other participants, even though your local video/audio may work.

## Common Causes

### 1. Network Connectivity Issues
- **Symptom**: Transport fails immediately or times out
- **Check**: 
  - Internet connection is stable
  - No VPN blocking WebRTC
  - Firewall allows UDP/TCP traffic on WebRTC ports

### 2. Firewall Blocking WebRTC
- **Symptom**: Transport connects but then fails
- **Check**:
  - Corporate firewall may block WebRTC
  - Router firewall settings
  - Windows Firewall / macOS Firewall
- **Solution**: Allow UDP/TCP traffic on ports 10000-20000 (MediaSoup default range)

### 3. DTLS Handshake Failure
- **Symptom**: Transport fails during connection
- **Check**: Browser console for DTLS-related errors
- **Solution**: 
  - Check server certificate (if using HTTPS)
  - Ensure server is accessible
  - Try refreshing the page

### 4. Server-Side Transport Error
- **Symptom**: Server logs show transport connection errors
- **Check**: Server console for errors
- **Solution**:
  - Verify MediaSoup worker is running
  - Check server resources (CPU, memory)
  - Restart server if needed

### 5. ICE Connection Failure
- **Symptom**: Transport stays in "connecting" state
- **Check**: Browser console for ICE-related errors
- **Solution**:
  - Check `announcedIp` in server config matches your network IP
  - Verify STUN/TURN servers if configured
  - Check NAT traversal settings

## Diagnostic Steps

### Step 1: Check Browser Console
Look for these messages:
- `❌ Receive transport connection FAILED`
- `Receive transport state: failed`
- `DTLS handshake failed`
- `ICE connection failed`

### Step 2: Check Network Tab
1. Open browser DevTools → Network tab
2. Filter for WebSocket connections
3. Check if WebSocket is connected
4. Look for failed requests

### Step 3: Check Server Logs
Look for:
- `Error connecting transport`
- `Transport not found`
- `Peer not found`
- `dtlsParameters is required`

### Step 4: Test Network Connectivity
```bash
# Test if server is reachable
ping YOUR_SERVER_IP

# Test WebSocket connection
# Use browser console:
socket.connected  // Should be true
```

## Quick Fixes

### Fix 1: Refresh the Page
- Simple but effective
- Reinitializes transports
- Clears any stale connections

### Fix 2: Check Server Configuration
Verify `server.js` has correct network settings:
```javascript
webRtcTransport: {
  listenIps: [
    {
      ip: '0.0.0.0',
      announcedIp: 'YOUR_LOCAL_IP', // Must match your network IP
    },
  ],
}
```

### Fix 3: Check Firewall
- Windows: Allow Node.js through Windows Firewall
- macOS: System Preferences → Security → Firewall
- Linux: Check iptables/ufw rules

### Fix 4: Restart Server
```bash
# Stop server (Ctrl+C)
# Start again
npm start
```

## Advanced Debugging

### Enable Detailed Logging
The code now includes comprehensive logging. Check browser console for:
- `🔄 Receive transport connect event triggered`
- `✅ Receive transport connect response received`
- `❌ Receive transport connect error from server`

### Check Transport State
Run in browser console:
```javascript
// Check receive transport state
console.log('Receive transport state:', recvTransport.connectionState);
console.log('Receive transport ID:', recvTransport.id);

// Check if socket is connected
console.log('Socket connected:', socket.connected);
```

### Monitor Connection State Changes
The code logs all state changes:
- `new` → Initial state
- `connecting` → Attempting to connect
- `connected` → Successfully connected
- `failed` → Connection failed
- `disconnected` → Connection lost

## Expected Behavior

### Normal Flow
1. Receive transport created → `new` state
2. Transport connect event triggered → `connecting` state
3. Server responds → `connected` state
4. Remote video/audio can be consumed

### Failure Flow
1. Receive transport created → `new` state
2. Transport connect event triggered → `connecting` state
3. Connection fails → `failed` state
4. Error logged → Remote video/audio won't work

## Prevention

### Server-Side
- Ensure MediaSoup workers are healthy
- Monitor server resources
- Use proper network configuration
- Handle errors gracefully

### Client-Side
- Implement retry logic (already added)
- Show user-friendly error messages
- Provide recovery options
- Log detailed diagnostics

## Still Not Working?

1. **Check all console logs** - Look for patterns
2. **Test with two browsers** - Is it one user or all?
3. **Check server logs** - Look for server-side errors
4. **Test network** - Try different network
5. **Check MediaSoup version** - Ensure compatibility

## Related Issues

- Remote video not displaying → May be caused by transport failure
- Audio not working → Check both send and receive transports
- Connection drops → May be related to transport state

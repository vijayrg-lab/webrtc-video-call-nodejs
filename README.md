# WebRTC Video Call Application with MediaSoup

A scalable video conferencing application built with WebRTC, Node.js, and MediaSoup that can handle 50-100 concurrent users.

## Features

- 🎥 Multi-user video conferencing (50-100 users)
- 🎤 Audio and video streaming
- 🔄 Real-time peer-to-peer communication via MediaSoup SFU
- 📱 Responsive web interface
- 🚀 Scalable architecture with multiple MediaSoup workers

## Architecture

- **Frontend**: HTML5 with WebRTC API
- **Signaling Server**: Node.js with Socket.IO
- **Media Server**: MediaSoup SFU (Selective Forwarding Unit)
- **Transport**: WebRTC for peer-to-peer media streaming

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Modern web browser with WebRTC support (Chrome, Firefox, Safari, Edge)

## Installation

1. Navigate to the project directory:
```bash
cd webrtc-video-call
```

2. Install dependencies:
```bash
npm install
```

## Configuration

### Server Configuration

Edit `server.js` to configure:

1. **MediaSoup Workers**: Adjust `numWorkers` based on your server CPU cores
2. **Port Range**: Modify `rtcMinPort` and `rtcMaxPort` for WebRTC
3. **Public IP**: Set `announcedIp` in `webRtcTransport.listenIps` if behind NAT/firewall

```javascript
// In server.js, update for production:
listenIps: [
  {
    ip: '0.0.0.0',
    announcedIp: 'YOUR_PUBLIC_IP', // Set your public IP here
  },
],
```

### Port Configuration

Default port is 3000. Change via environment variable:
```bash
PORT=8080 npm start
```

## Running the Application

1. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

3. Enter a Room ID and your name, then click "Join Room"

4. Allow camera and microphone permissions when prompted

5. Share the Room ID with others to have them join the same room

## Usage

1. **Join a Room**: Enter a room ID and your name, then click "Join Room"
2. **Share Room ID**: Share the room ID with others to invite them
3. **Toggle Video**: Click "Toggle Video" to pause/resume your video
4. **Toggle Audio**: Click "Toggle Audio" to mute/unmute your audio
5. **Leave Room**: Click "Leave Room" to disconnect

## Production Deployment

### Important Considerations

1. **HTTPS Required**: WebRTC requires HTTPS in production (except localhost)
   - Use a reverse proxy (nginx) with SSL certificate
   - Or use a service like Let's Encrypt

2. **Firewall Configuration**: Open UDP ports 40000-49999 (or your configured range)

3. **Server Resources**: 
   - CPU: Multiple cores recommended (one worker per core)
   - RAM: ~100MB per active user
   - Bandwidth: ~1-2 Mbps per user (upload + download)

4. **Nginx Configuration** (example):
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

5. **Environment Variables**:
```bash
PORT=3000
NODE_ENV=production
```

## Troubleshooting

### Camera/Microphone Not Working
- Check browser permissions
- Ensure HTTPS is used (except localhost)
- Verify camera/microphone are not in use by other applications

### Connection Issues
- Check firewall settings (UDP ports 40000-49999)
- Verify `announcedIp` is set correctly if behind NAT
- Check server logs for errors

### Performance Issues
- Increase number of workers in `mediasoupConfig.numWorkers`
- Monitor server CPU and memory usage
- Consider load balancing for very high user counts

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (macOS 11+, iOS 14+)
- Opera: Full support

## License

MIT

## Support

For issues and questions, please check:
- MediaSoup documentation: https://mediasoup.org/
- WebRTC documentation: https://webrtc.org/


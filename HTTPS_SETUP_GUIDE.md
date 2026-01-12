# HTTPS Setup Guide for WebRTC Mobile Testing

## Why Mobile Browsers Block HTTP for WebRTC

### The Secure Context Requirement

**WebRTC requires a "Secure Context"** to access camera and microphone. This is a security feature implemented by all modern browsers.

### What is a Secure Context?

A secure context is provided when:
- ✅ **HTTPS** (`https://`)
- ✅ **localhost** (`http://localhost` or `http://127.0.0.1`)
- ✅ **file://** protocol (local files)

### Why Mobile Browsers Are Stricter

**Desktop browsers** (Chrome, Firefox, Edge):
- Allow `localhost` and `127.0.0.1` over HTTP
- Block `192.168.x.x` over HTTP ❌

**Mobile browsers** (iOS Safari, Android Chrome):
- Allow `localhost` over HTTP ✅
- **Block ALL IP addresses over HTTP** ❌ (including `192.168.x.x`)
- Require HTTPS for any network IP address

### Security Rationale

1. **Man-in-the-Middle Attacks**: HTTP traffic can be intercepted
2. **Privacy Protection**: Camera/mic access is sensitive
3. **W3C Specification**: WebRTC spec requires secure context
4. **Mobile Security**: Mobile devices are more vulnerable to network attacks

### The Problem

```
Desktop:  http://localhost:3004        ✅ Works
Desktop:  http://192.168.1.8:3004      ❌ Blocked
Mobile:   http://localhost:3004        ✅ Works (if on same device)
Mobile:   http://192.168.1.8:3004      ❌ BLOCKED (your case)
Mobile:   https://192.168.1.8:3004     ✅ Works
```

---

## Solution 1: mkcert (Recommended for Local Development)

**Best for**: Local development and testing on mobile devices

### Why mkcert?
- Creates locally-trusted certificates
- Works on mobile devices (with setup)
- No external services needed
- Fast and reliable

### Installation

**Windows:**
```bash
# Using Chocolatey
choco install mkcert

# Or download from: https://github.com/FiloSottile/mkcert/releases
```

**macOS:**
```bash
brew install mkcert
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt install libnss3-tools
wget https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64
chmod +x mkcert-v1.4.4-linux-amd64
sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
```

### Setup Steps

1. **Install local CA:**
```bash
mkcert -install
```

2. **Create certificate for your IP:**
```bash
# Replace 192.168.1.8 with your actual IP
mkcert 192.168.1.8 localhost 127.0.0.1 ::1
```

This creates:
- `192.168.1.8+3.pem` (certificate)
- `192.168.1.8+3-key.pem` (private key)

3. **Move certificates to project:**
```bash
mkdir -p certs
mv 192.168.1.8+3.pem certs/cert.pem
mv 192.168.1.8+3-key.pem certs/key.pem
```

4. **Update server.js** (see Solution 1 code below)

5. **Install certificate on mobile device:**

   **Android:**
   - Transfer `rootCA.pem` to phone (find it with `mkcert -CAROOT`)
   - Settings > Security > Install from storage
   - Select the certificate
   - Name it "mkcert" and install

   **iOS:**
   - Transfer `rootCA.pem` to phone (AirDrop, email, etc.)
   - Settings > General > VPN & Device Management
   - Tap the certificate
   - Install and trust it

6. **Start server:**
```bash
npm start
```

7. **Access from mobile:**
```
https://192.168.1.8:3004
```

---

## Solution 2: Self-Signed Certificate (Quick Test)

**Best for**: Quick testing (requires manual trust on each device)

### Generate Certificate

```bash
mkdir -p certs
cd certs

# Generate private key
openssl genrsa -out key.pem 2048

# Generate certificate (valid for 365 days)
openssl req -new -x509 -key key.pem -out cert.pem -days 365 -subj "/CN=192.168.1.8"
```

### Trust Certificate on Mobile

**Android Chrome:**
1. Open `https://192.168.1.8:3004`
2. Tap "Advanced"
3. Tap "Proceed to 192.168.1.8 (unsafe)"
4. Accept the warning

**iOS Safari:**
1. Open `https://192.168.1.8:3004`
2. Tap "Advanced"
3. Tap "Proceed to Website"
4. Go to Settings > General > About > Certificate Trust Settings
5. Enable trust for the certificate

**Note**: Self-signed certs show warnings but work for testing.

---

## Solution 3: ngrok (Easiest for Quick Testing)

**Best for**: Quick testing without certificate setup

### Installation

```bash
# Download from https://ngrok.com/download
# Or using package manager
npm install -g ngrok
# or
brew install ngrok
```

### Setup

1. **Sign up** at https://ngrok.com (free account)

2. **Get authtoken:**
```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

3. **Start your HTTP server:**
```bash
npm start
```

4. **In another terminal, start ngrok:**
```bash
ngrok http 3004
```

5. **Copy the HTTPS URL** (e.g., `https://abc123.ngrok.io`)

6. **Access from mobile:**
```
https://abc123.ngrok.io
```

### Pros & Cons

✅ **Pros:**
- No certificate setup
- Works immediately
- Public URL (can share)

❌ **Cons:**
- Requires internet
- Free tier has limitations
- URL changes on restart (unless paid)

---

## Solution 4: Cloudflare Tunnel (Free Alternative)

**Best for**: Production-like testing, free permanent URL

### Installation

```bash
# Download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
```

### Setup

1. **Create Cloudflare account** (free)

2. **Authenticate:**
```bash
cloudflared tunnel login
```

3. **Create tunnel:**
```bash
cloudflared tunnel create webrtc-test
```

4. **Configure tunnel:**
Create `config.yml`:
```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /path/to/credentials.json

ingress:
  - hostname: webrtc-test.yourdomain.com
    service: http://localhost:3004
  - service: http_status:404
```

5. **Start tunnel:**
```bash
cloudflared tunnel run webrtc-test
```

6. **Access from mobile:**
```
https://webrtc-test.yourdomain.com
```

---

## Solution 5: Production HTTPS (Let's Encrypt)

**Best for**: Production deployment

### Using Certbot

```bash
# Install certbot
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com

# Certificates saved to:
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem
```

### Auto-renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Add to crontab
sudo crontab -e
# Add: 0 0 * * * certbot renew --quiet
```

---

## Testing Checklist

### Android Chrome
- [ ] HTTPS URL loads
- [ ] Certificate trusted (no warnings)
- [ ] Camera permission prompt appears
- [ ] Microphone permission prompt appears
- [ ] Video stream works
- [ ] Audio stream works

### iOS Safari
- [ ] HTTPS URL loads
- [ ] Certificate trusted (no warnings)
- [ ] Camera permission prompt appears
- [ ] Microphone permission prompt appears
- [ ] Video stream works
- [ ] Audio stream works

### Common Issues

**Issue**: "NET::ERR_CERT_AUTHORITY_INVALID"
- **Fix**: Trust the certificate on mobile device

**Issue**: "Connection refused"
- **Fix**: Check firewall allows port 3004

**Issue**: "Certificate expired"
- **Fix**: Regenerate certificate (mkcert) or renew (Let's Encrypt)

---

## Quick Reference

| Solution | Setup Time | Mobile Setup | Best For |
|----------|-----------|--------------|----------|
| mkcert | 5 min | Install CA | Local dev |
| Self-signed | 2 min | Trust cert | Quick test |
| ngrok | 2 min | None | Demo/testing |
| Cloudflare | 10 min | None | Production-like |
| Let's Encrypt | 15 min | None | Production |

---

## Next Steps

1. Choose a solution based on your needs
2. Follow the setup steps
3. Update `server.js` (see code examples below)
4. Test on mobile device
5. Share HTTPS URL with team

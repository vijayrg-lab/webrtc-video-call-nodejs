# Quick Start: HTTPS for Mobile Testing

## The Problem

Mobile browsers **block HTTP for WebRTC**. You need HTTPS to test on mobile devices.

```
❌ http://192.168.1.8:3004  (Blocked on mobile)
✅ https://192.168.1.8:3004 (Works on mobile)
```

## Fastest Solution: mkcert (5 minutes)

### Step 1: Install mkcert

**macOS:**
```bash
brew install mkcert
```

**Windows:**
```bash
choco install mkcert
```

**Linux:**
```bash
sudo apt install libnss3-tools
wget https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64
chmod +x mkcert-v1.4.4-linux-amd64
sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
```

### Step 2: Run Setup Script

**macOS/Linux:**
```bash
chmod +x setup-https.sh
./setup-https.sh
```

**Windows:**
```bash
setup-https.bat
```

**Or manually:**
```bash
# Install local CA
mkcert -install

# Generate certificates (replace 192.168.1.8 with your IP)
mkcert -cert-file certs/cert.pem -key-file certs/key.pem 192.168.1.8 localhost 127.0.0.1 ::1
```

### Step 3: Start Server with HTTPS

```bash
npm run start:https
```

Or set environment variable:
```bash
export USE_HTTPS=true
npm start
```

### Step 4: Install CA on Mobile Device

**Find CA location:**
```bash
mkcert -CAROOT
```

**Android:**
1. Transfer `rootCA.pem` to phone
2. Settings > Security > Install from storage
3. Select certificate
4. Name it "mkcert" and install

**iOS:**
1. Transfer `rootCA.pem` to phone (AirDrop/email)
2. Settings > General > VPN & Device Management
3. Tap certificate
4. Install and trust

### Step 5: Access from Mobile

```
https://192.168.1.8:3004
```

---

## Alternative: ngrok (2 minutes, no setup)

### Step 1: Install ngrok

```bash
npm install -g ngrok
# or
brew install ngrok
```

### Step 2: Sign up

Go to https://ngrok.com and sign up (free)

### Step 3: Get authtoken

```bash
ngrok config add-authtoken YOUR_TOKEN
```

### Step 4: Start Server

```bash
npm start
```

### Step 5: Start ngrok (in another terminal)

```bash
ngrok http 3004
```

### Step 6: Use HTTPS URL

Copy the `https://` URL from ngrok output and use it on mobile.

**Note**: URL changes on restart (unless paid plan).

---

## Testing Checklist

- [ ] HTTPS URL loads on mobile
- [ ] No certificate warnings
- [ ] Camera permission prompt appears
- [ ] Microphone permission prompt appears
- [ ] Video works
- [ ] Audio works

---

## Troubleshooting

### "NET::ERR_CERT_AUTHORITY_INVALID"
**Fix**: Install and trust the CA certificate on mobile device

### "Connection refused"
**Fix**: 
- Check firewall allows port 3004
- Ensure server is listening on `0.0.0.0`, not `localhost`

### "Certificate not found"
**Fix**: 
- Run setup script again
- Check `certs/` directory exists
- Verify `USE_HTTPS=true` is set

---

## Production Deployment

For production, use Let's Encrypt:

```bash
sudo certbot certonly --standalone -d yourdomain.com
```

Then set:
```bash
export SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
export SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
export USE_HTTPS=true
```

---

## Summary

| Method | Time | Mobile Setup | Best For |
|--------|------|--------------|----------|
| mkcert | 5 min | Install CA | Local dev |
| ngrok | 2 min | None | Quick test |
| Let's Encrypt | 15 min | None | Production |

**Recommended**: Use mkcert for local development, Let's Encrypt for production.

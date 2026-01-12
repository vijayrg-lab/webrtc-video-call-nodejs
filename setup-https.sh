#!/bin/bash

# HTTPS Setup Script for WebRTC Mobile Testing
# This script helps set up HTTPS certificates using mkcert

set -e

echo "=========================================="
echo "WebRTC HTTPS Setup Script"
echo "=========================================="
echo ""

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "❌ mkcert is not installed."
    echo ""
    echo "Install mkcert:"
    echo "  macOS:   brew install mkcert"
    echo "  Windows: choco install mkcert"
    echo "  Linux:   See https://github.com/FiloSottile/mkcert"
    echo ""
    exit 1
fi

echo "✓ mkcert found"
echo ""

# Get local IP address
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr eth0 2>/dev/null || hostname -I | awk '{print $1}' || echo "192.168.1.8")
echo "Detected local IP: $LOCAL_IP"
read -p "Use this IP? (y/n) [y]: " confirm
confirm=${confirm:-y}

if [ "$confirm" != "y" ]; then
    read -p "Enter your local IP address: " LOCAL_IP
fi

echo ""
echo "Setting up certificates for:"
echo "  - $LOCAL_IP"
echo "  - localhost"
echo "  - 127.0.0.1"
echo ""

# Install local CA (if not already installed)
if [ ! -f "$(mkcert -CAROOT)/rootCA.pem" ]; then
    echo "Installing local CA..."
    mkcert -install
    echo "✓ Local CA installed"
else
    echo "✓ Local CA already installed"
fi

# Create certs directory
mkdir -p certs

# Generate certificates
echo ""
echo "Generating certificates..."
mkcert -cert-file certs/cert.pem -key-file certs/key.pem $LOCAL_IP localhost 127.0.0.1 ::1

echo ""
echo "=========================================="
echo "✓ Certificates generated successfully!"
echo "=========================================="
echo ""
echo "Certificates saved to:"
echo "  - certs/cert.pem"
echo "  - certs/key.pem"
echo ""
echo "Next steps:"
echo "1. Set USE_HTTPS=true environment variable:"
echo "   export USE_HTTPS=true"
echo ""
echo "2. Or add to .env file:"
echo "   echo 'USE_HTTPS=true' >> .env"
echo ""
echo "3. Start the server:"
echo "   npm start"
echo ""
echo "4. Access from mobile:"
echo "   https://$LOCAL_IP:3004"
echo ""
echo "5. Install CA on mobile device:"
echo "   CA location: $(mkcert -CAROOT)/rootCA.pem"
echo "   Transfer this file to your mobile device and install it"
echo ""

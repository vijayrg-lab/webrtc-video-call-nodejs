const socket = io();

const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomInput");
const roleSelect = document.getElementById("roleSelect");
const localVideo = document.getElementById("localVideo");
const videosDiv = document.getElementById("videos");

let localStream;
let peers = {}; // userId -> RTCPeerConnection
let roomId;
let role;

// Get camera + mic
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
.then(stream => {
    localStream = stream;
    localVideo.srcObject = stream;
});

// Join room
joinBtn.onclick = () => {
    roomId = roomInput.value || "default-room";
    role = roleSelect.value;

    socket.emit("join-room", roomId, role);
};

// Room full
socket.on("room-full", () => alert("Room is full!"));

socket.on("joined-room", ({ roomId: r, role: myRole }) => {
    console.log(`Joined room ${r} as ${myRole}`);
});

// Moderator: when new user joins
socket.on("user-joined", async (userId) => {
    if (role !== "moderator") return;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peers[userId] = pc;

    // Add local tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Remote video for moderator (optional)
    const remoteVideo = document.createElement("video");
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    videosDiv.appendChild(remoteVideo);

    pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

    // ICE candidates
    pc.onicecandidate = e => {
        if (e.candidate) {
            socket.emit("ice-candidate", { to: userId, candidate: e.candidate });
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", { roomId, offer, to: userId, from: socket.id, fromRole: role });
});

// Receive offer
socket.on("offer", async (data) => {
    if (data.to !== socket.id) return;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peers[data.from] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const remoteVideo = document.createElement("video");
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    videosDiv.appendChild(remoteVideo);

    pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

    pc.onicecandidate = e => {
        if (e.candidate) {
            socket.emit("ice-candidate", { to: data.from, candidate: e.candidate });
        }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", { to: data.from, answer, from: socket.id });
});

// Receive answer
socket.on("answer", async (data) => {
    const pc = peers[data.to];
    if (pc) await pc.setRemoteDescription(data.answer);
});

// ICE candidate
socket.on("ice-candidate", async (data) => {
    const pc = peers[data.to];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
});

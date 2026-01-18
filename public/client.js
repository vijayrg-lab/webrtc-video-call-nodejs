const socket = io();

const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomInput");
const roleSelect = document.getElementById("roleSelect");
const localVideo = document.getElementById("localVideo");
const videosDiv = document.getElementById("videos");

let localStream;
let peers = {}; // peerId → RTCPeerConnection
let role;
let roomId;

// Get camera + mic
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    localStream = stream;
    localVideo.srcObject = stream;
  });

joinBtn.onclick = () => {
  roomId = roomInput.value || "default-room";
  role = roleSelect.value;

  socket.emit("join-room", roomId, role);
};

socket.on("room-full", () => alert("Room is full!"));

socket.on("joined-room", ({ roomId: r, role: myRole }) => {
  console.log(`Joined room ${r} as ${myRole}`);
});

// Moderator sees user streams
socket.on("user-joined", async (userId) => {
  if (role !== "moderator") return;

  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { to: userId, candidate: event.candidate });
    }
  };

  // Optional: show user video for moderator
  const remoteVideo = document.createElement("video");
  remoteVideo.autoplay = true;
  remoteVideo.playsInline = true;
  videosDiv.appendChild(remoteVideo);
  pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { roomId, offer, to: userId, fromRole: role });

  peers[userId] = pc;
});

socket.on("offer", async (data) => {
  const { fromRole, offer, to } = data;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  peers[data.from] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { to: data.from, candidate: event.candidate });
    }
  };

  if (role === "user") {
    // Only show moderator video
    const remoteVideo = document.createElement("video");
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    videosDiv.appendChild(remoteVideo);

    pc.ontrack = e => remoteVideo.srcObject = e.streams[0];
  }

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer", { to: data.from, answer });
});

socket.on("answer", async (data) => {
  const pc = peers[data.to];
  if (pc) await pc.setRemoteDescription(data.answer);
});

socket.on("ice-candidate", async (data) => {
  const pc = peers[data.to];
  if (pc) await pc.addIceCandidate(data.candidate);
});

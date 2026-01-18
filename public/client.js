const socket = io(); // 🔥 NO URL HERE

const roomId = window.location.pathname.substring(1) || "default-room";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const peer = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
});

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    localVideo.srcObject = stream;
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
  });

peer.ontrack = (event) => {
  remoteVideo.srcObject = event.streams[0];
};

peer.onicecandidate = (event) => {
  if (event.candidate) {
    socket.emit("ice-candidate", {
      roomId,
      candidate: event.candidate
    });
  }
};

socket.emit("join-room", roomId);

// When new user joins
socket.on("user-joined", async () => {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  socket.emit("offer", { roomId, offer });
});

socket.on("offer", async (data) => {
  await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  socket.emit("answer", { roomId, answer });
});

socket.on("answer", async (data) => {
  await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on("ice-candidate", async (data) => {
  if (data.candidate) {
    await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

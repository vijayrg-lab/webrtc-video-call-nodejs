const socket = io("YOUR_RAILWAY_BACKEND_URL");

const pc = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
});

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    document.querySelector("#local").srcObject = stream;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
  });

pc.ontrack = (e) => {
  document.querySelector("#remote").srcObject = e.streams[0];
};

pc.onicecandidate = (e) => {
  if (e.candidate) {
    socket.emit("ice-candidate", {
      candidate: e.candidate,
      roomId
    });
  }
};

socket.emit("join-room", roomId);

socket.on("user-joined", async () => {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { offer, roomId });
});

socket.on("offer", async (data) => {
  await pc.setRemoteDescription(data.offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { answer, roomId });
});

socket.on("answer", (data) => {
  pc.setRemoteDescription(data.answer);
});

socket.on("ice-candidate", (data) => {
  pc.addIceCandidate(data.candidate);
});

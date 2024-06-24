'use strict';
import QUICKVIDEO_API from './api.json' with { type: 'json' };

if (QUICKVIDEO_API.key == '🤫') alert('Please put your api key inside ./api.json and restart..');

const RTCPeerConnection = (
  window.RTCPeerConnection ||
  window.webkitRTCPeerConnection ||
  window.mozRTCPeerConnection
).bind(window);

let peerConnection;
let streamId;
let sessionId;
let sessionClientAnswer;

let statsIntervalId;
let videoIsPlaying;
let lastBytesReceived;
let isListening = false;
let text = '';

const micButton = document.getElementById('mic-button');
const micStopButton = document.getElementById('mic-stop-button');
const inputField = document.getElementById('input-field');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');

if(textInput.value === '') {
  sendButton.style.display = 'none';
} else {
  sendButton.style.display = 'block';
}

textInput.addEventListener('input', handleInputChange);
function handleInputChange(event) {
  const inputValue = event.target.value;
  textInput.value = inputValue;
  if (inputValue === '') {
    sendButton.style.display = 'none';
  } else {
    sendButton.style.display = 'block';
  }
}

sendButton.addEventListener('click', sendDataToWebhook);

const handleResult = (phrases) => {
  text = phrases[0];
  textInput.value = text;
};

const addAnnyangCallback = () => {
  annyang.addCallback('result', handleResult);
};

const removeAnnyangCallback = () => {
  annyang.removeCallback('result', handleResult);
};

document.addEventListener('DOMContentLoaded', () => {
  addAnnyangCallback();

  return () => {
    removeAnnyangCallback();
  };
});

const startRecognition = () => {
  micButton.style.display='none'
  micStopButton.style.display='block'
  annyang.start();
};

const stopRecognition = () => {
  micButton.style.display='block'
  micStopButton.style.display='none'
  annyang.abort();
};

micButton.addEventListener('click', () => {
  isListening = true;
  startRecognition();
});

function sendDataToWebhook () {
  const data = {
    text: textInput.value,
  };

  fetch(`${QUICKVIDEO_API.url}/status/webhook/${streamId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${QUICKVIDEO_API.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  })
  .then(response => {
    if (!response.ok) {
      textInput.value = '';
      throw new Error('Network response was not ok');
    }
    return response.json();
  })
  .then(data => {
    textInput.value = '';
    console.log('POST request succeeded with JSON response:', data);
  })
  .catch(error => {
    console.error('There was a problem with the POST request:', error);
  });
}

micStopButton.addEventListener('click', () => {
  isListening = false;
  stopRecognition();
  sendDataToWebhook();
});

const statusIndicator = document.getElementById('status-indicator');
const talkVideo = document.getElementById('talk-video');
talkVideo.setAttribute('playsinline', '');
const peerStatusLabel = document.getElementById('peer-status-label');
const iceStatusLabel = document.getElementById('ice-status-label');
const iceGatheringStatusLabel = document.getElementById('ice-gathering-status-label');
const signalingStatusLabel = document.getElementById('signaling-status-label');
const streamingStatusLabel = document.getElementById('streaming-status-label');

const connectButton = document.getElementById('connect-button');
const talkButton = document.getElementById('talk-button');
const destroyButton = document.getElementById('destroy-button');
talkButton.classList.add('disabled');
destroyButton.classList.add('disabled');

connectButton.onclick = async () => {
  if (peerConnection && peerConnection.connectionState === 'connected') {
    return;
  }
  console.log(peerConnection);
  stopAllStreams();
  closePC();

  const sessionResponse = await fetchWithRetries(`${QUICKVIDEO_API.url}/talks/streams`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${QUICKVIDEO_API.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_url: 'https://quickvideo.blob.core.windows.net/quickvideo/ai_bot/37.png',
    }),
  });

  const { id: newStreamId, offer, ice_servers: iceServers, session_id: newSessionId } = await sessionResponse.json();
  streamId = newStreamId;
  sessionId = newSessionId;

  try {
    sessionClientAnswer = await createPeerConnection(offer, iceServers);
    inputField.style.display = 'flex';
    connectButton.classList.add('disabled');
    talkButton.classList.remove('disabled');
    destroyButton.classList.remove('disabled');
  } catch (e) {
    console.log('error during streaming setup', e);
    stopAllStreams();
    closePC();
    return;
  }
  console.log("sessionClientAnswer",sessionClientAnswer);

  const sdpResponse = await fetch(`${QUICKVIDEO_API.url}/talks/streams/${streamId}/sdp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${QUICKVIDEO_API.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      answer: sessionClientAnswer,
      session_id: sessionId,
    }),
  });
};

talkButton.onclick = async () => {
  if (peerConnection?.signalingState === 'stable' || peerConnection?.iceConnectionState === 'connected') {
    const talkResponse = await fetchWithRetries(`${QUICKVIDEO_API.url}/talks/streams/${streamId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${QUICKVIDEO_API.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        script: {
          type: 'audio',
          audio_url: 'https://quickvideo.blob.core.windows.net/quickvideo/generated_audios/ae78_audio.mp3',
        },
        driver_url: 'bank://lively/',
        config: {
          stitch: true,
        },
        session_id: sessionId,
      }),
    });
  }
};

destroyButton.onclick = async () => {
  await fetch(`${QUICKVIDEO_API.url}/talks/streams/${streamId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${QUICKVIDEO_API.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session_id: sessionId }),
  });
  inputField.style.display = 'none';
  connectButton.classList.remove('disabled');
  talkButton.classList.add('disabled');
  destroyButton.classList.add('disabled');
  stopAllStreams();
  closePC();
};

function onIceGatheringStateChange() {
  iceGatheringStatusLabel.innerText = peerConnection.iceGatheringState;
  iceGatheringStatusLabel.className = 'iceGatheringState-' + peerConnection.iceGatheringState;
}
function onIceCandidate(event) {
  console.log('onIceCandidate', event);
  if (event.candidate) {
    const { candidate, sdpMid, sdpMLineIndex } = event.candidate;

    fetch(`${QUICKVIDEO_API.url}/talks/streams/${streamId}/ice`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${QUICKVIDEO_API.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        candidate,
        sdpMid,
        sdpMLineIndex,
        session_id: sessionId,
      }),
    });
  }
}
function onIceConnectionStateChange() {
  iceStatusLabel.innerText = peerConnection.iceConnectionState;
  iceStatusLabel.className = 'iceConnectionState-' + peerConnection.iceConnectionState;
  if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'closed') {
    stopAllStreams();
    closePC();
  }
}
function onConnectionStateChange() {
  peerStatusLabel.innerText = peerConnection.connectionState;
  peerStatusLabel.className = 'peerConnectionState-' + peerConnection.connectionState;
}
function onSignalingStateChange() {
  signalingStatusLabel.innerText = peerConnection.signalingState;
  signalingStatusLabel.className = 'signalingState-' + peerConnection.signalingState;
}

function onVideoStatusChange(videoIsPlaying, stream) {
  let status;
  if (videoIsPlaying) {
    status = 'streaming';
    const remoteStream = stream;
    setVideoElement(remoteStream);
    statusIndicator.innerText = 'playing';
    statusIndicator.className = 'statusIndicator-playing'
  } else {
    status = 'empty';
    playIdleVideo();
    statusIndicator.innerText = 'stopped';
    statusIndicator.className = 'statusIndicator-stopped'
  }
  streamingStatusLabel.innerText = status;
  streamingStatusLabel.className = 'streamingState-' + status;
}

function onTrack(event) {
  if (!event.track) return;

  statsIntervalId = setInterval(async () => {
    const stats = await peerConnection.getStats(event.track);
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
        const videoStatusChanged = videoIsPlaying !== report.bytesReceived > lastBytesReceived;

        if (videoStatusChanged) {
          videoIsPlaying = report.bytesReceived > lastBytesReceived;
          onVideoStatusChange(videoIsPlaying, event.streams[0]);
        }
        lastBytesReceived = report.bytesReceived;
      }
    });
  }, 500);
}

async function createPeerConnection(offer, iceServers) {
  if (!peerConnection) {
    peerConnection = new RTCPeerConnection({ iceServers });
    peerConnection.addEventListener('icegatheringstatechange', onIceGatheringStateChange, true);
    peerConnection.addEventListener('icecandidate', onIceCandidate, true);
    peerConnection.addEventListener('iceconnectionstatechange', onIceConnectionStateChange, true);
    peerConnection.addEventListener('connectionstatechange', onConnectionStateChange, true);
    peerConnection.addEventListener('signalingstatechange', onSignalingStateChange, true);
    peerConnection.addEventListener('track', onTrack, true);
  }

  await peerConnection.setRemoteDescription(offer);
  console.log('set remote sdp OK');

  const sessionClientAnswer = await peerConnection.createAnswer();
  console.log('create local sdp OK');

  await peerConnection.setLocalDescription(sessionClientAnswer);
  console.log('set local sdp OK');

  return sessionClientAnswer;
}

function setVideoElement(stream) {
  if (!stream) return;
  talkVideo.srcObject = stream;
  talkVideo.loop = false;

  // safari hotfix
  if (talkVideo.paused) {
    talkVideo
      .play()
      .then((_) => {})
      .catch((e) => {});
  }
}

function playIdleVideo() {
  talkVideo.srcObject = undefined;
  talkVideo.src = 'or_idle.mp4';
  talkVideo.loop = true;
  statusIndicator.innerText = 'stopped';
  statusIndicator.className = 'statusIndicator-stopped'
}

function stopAllStreams() {
  if (talkVideo.srcObject) {
    console.log('stopping video streams');
    talkVideo.srcObject.getTracks().forEach((track) => track.stop());
    talkVideo.srcObject = null;
  }
}

function closePC(pc = peerConnection) {
  if (!pc) return;
  console.log('stopping peer connection');
  pc.close();
  pc.removeEventListener('icegatheringstatechange', onIceGatheringStateChange, true);
  pc.removeEventListener('icecandidate', onIceCandidate, true);
  pc.removeEventListener('iceconnectionstatechange', onIceConnectionStateChange, true);
  pc.removeEventListener('connectionstatechange', onConnectionStateChange, true);
  pc.removeEventListener('signalingstatechange', onSignalingStateChange, true);
  pc.removeEventListener('track', onTrack, true);
  clearInterval(statsIntervalId);
  iceGatheringStatusLabel.innerText = '';
  signalingStatusLabel.innerText = '';
  iceStatusLabel.innerText = '';
  peerStatusLabel.innerText = '';
  statusIndicator.innerText = '';
  console.log('stopped peer connection');
  if (pc === peerConnection) {
    peerConnection = null;
  }
}

const maxRetryCount = 3;
const maxDelaySec = 4;

async function fetchWithRetries(url, options, retries = 1) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries <= maxRetryCount) {
      const delay = Math.min(Math.pow(2, retries) / 4 + Math.random(), maxDelaySec) * 1000;

      await new Promise((resolve) => setTimeout(resolve, delay));

      console.log(`Request failed, retrying ${retries}/${maxRetryCount}. Error ${err}`);
      return fetchWithRetries(url, options, retries + 1);
    } else {
      throw new Error(`Max retries exceeded. error: ${err}`);
    }
  }
}

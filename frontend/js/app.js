/* ==========================================================================
   AuraNote AI - Voice-to-Text Meeting Assistant JavaScript Logic
   ========================================================================== */

const API_BASE = "http://localhost:8000/api";

// Global App State
let appState = {
    currentMeeting: null,
    savedMeetings: [],
    selectedAudioFile: null,
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
    recordStartTime: null,
    timerInterval: null,
    audioContext: null,
    analyser: null,
    canvasAnimId: null,
    liveRecognition: null
};

// Initialize Application on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
    initCanvas();
    fetchMeetingHistory();
    setupDropzone();
    checkBackendEngineStatus();
});

// View Navigation Switcher
function switchView(viewId) {
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));

    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.add("active");

    if (viewId === 'recorderView') {
        document.getElementById('navNewMeeting').classList.add('active');
        document.getElementById('viewHeading').innerText = "Live Meeting Recorder & AI Studio";
        document.getElementById('viewSubheading').innerText = "Record live speech or upload audio to generate transcriptions, summaries & action points";
    } else if (viewId === 'workspaceView') {
        document.getElementById('viewHeading').innerText = "Meeting Workspace & Intelligence";
        document.getElementById('viewSubheading').innerText = "Review transcript, summary, decisions, and manage action items";
    } else if (viewId === 'historyView') {
        document.getElementById('navHistory').classList.add('active');
        document.getElementById('viewHeading').innerText = "Meeting History Archive";
        document.getElementById('viewSubheading').innerText = "Access all past meeting recordings and AI reports";
        fetchMeetingHistory();
    } else if (viewId === 'actionsView') {
        document.getElementById('navActions').classList.add('active');
        document.getElementById('viewHeading').innerText = "Master Action Items Center";
        document.getElementById('viewSubheading').innerText = "Track tasks assigned across all meeting sessions";
        renderGlobalActionItems();
    }
}

// Check Backend Engine Status
async function checkBackendEngineStatus() {
    try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
            const data = await res.json();
            const statusText = document.getElementById("engineStatusText");
            if (data.whisper_available) {
                statusText.innerText = "Whisper AI Engine Ready";
            } else {
                statusText.innerText = "STT Fallback Active";
            }
        }
    } catch (err) {
        console.warn("Backend API check failed:", err);
    }
}

/* ==========================================================================
   Microphone Audio Recording & Waveform Visualizer
   ========================================================================== */

function initCanvas() {
    const canvas = document.getElementById("waveformCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0, 242, 254, 0.2)";
    ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Setup MediaRecorder
        appState.audioChunks = [];
        appState.mediaRecorder = new MediaRecorder(stream);

        appState.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                appState.audioChunks.push(event.data);
            }
        };

        appState.mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(appState.audioChunks, { type: 'audio/webm' });
            await processRecordedAudioBlob(audioBlob);
        };

        appState.mediaRecorder.start(1000);
        appState.isRecording = true;
        appState.recordStartTime = Date.now();

        // UI Updates
        document.getElementById("btnStartRecord").classList.add("hidden");
        document.getElementById("btnPauseRecord").classList.remove("hidden");
        document.getElementById("btnStopRecord").classList.remove("hidden");
        document.getElementById("visualizerPlaceholder").classList.add("hidden");

        // Start Timer & Audio Visualizer
        startTimer();
        setupAudioVisualizer(stream);
        startLiveSpeechRecognition();

    } catch (err) {
        alert("Microphone access denied or audio device not found: " + err.message);
    }
}

function pauseRecording() {
    if (!appState.mediaRecorder) return;
    const pauseBtn = document.getElementById("btnPauseRecord");
    
    if (appState.mediaRecorder.state === "recording") {
        appState.mediaRecorder.pause();
        pauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
        clearInterval(appState.timerInterval);
    } else if (appState.mediaRecorder.state === "paused") {
        appState.mediaRecorder.resume();
        pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
        startTimer();
    }
}

function stopRecording() {
    if (!appState.mediaRecorder) return;
    appState.mediaRecorder.stop();
    appState.isRecording = false;

    // Stop streams
    if (appState.mediaRecorder.stream) {
        appState.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    clearInterval(appState.timerInterval);
    if (appState.canvasAnimId) cancelAnimationFrame(appState.canvasAnimId);
    if (appState.liveRecognition) {
        try { appState.liveRecognition.stop(); } catch(e){}
    }

    // Reset Buttons UI
    document.getElementById("btnStartRecord").classList.remove("hidden");
    document.getElementById("btnPauseRecord").classList.add("hidden");
    document.getElementById("btnStopRecord").classList.add("hidden");
    document.getElementById("visualizerPlaceholder").classList.remove("hidden");
    document.getElementById("recordTimer").innerText = "00:00:00";
    initCanvas();
}

function startTimer() {
    clearInterval(appState.timerInterval);
    appState.timerInterval = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - appState.recordStartTime) / 1000);
        const hrs = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
        const mins = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
        const secs = String(elapsedSec % 60).padStart(2, '0');
        document.getElementById("recordTimer").innerText = `${hrs}:${mins}:${secs}`;
    }, 1000);
}

function setupAudioVisualizer(stream) {
    appState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = appState.audioContext.createMediaStreamSource(stream);
    appState.analyser = appState.audioContext.createAnalyser();
    appState.analyser.fftSize = 256;
    source.connect(appState.analyser);

    const canvas = document.getElementById("waveformCanvas");
    const ctx = canvas.getContext("2d");
    const bufferLength = appState.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        if (!appState.isRecording) return;
        appState.canvasAnimId = requestAnimationFrame(draw);

        appState.analyser.getByteFrequencyData(dataArray);
        ctx.fillStyle = "rgba(7, 10, 19, 0.4)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            
            const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
            gradient.addColorStop(0, '#00f2fe');
            gradient.addColorStop(1, '#4facfe');

            ctx.fillStyle = gradient;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }
    draw();
}

function startLiveSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    appState.liveRecognition = new SpeechRecognition();
    appState.liveRecognition.continuous = true;
    appState.liveRecognition.interimResults = true;

    appState.liveRecognition.onresult = (event) => {
        let transcriptStr = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcriptStr += event.results[i][0].transcript;
        }
        document.getElementById("liveStreamText").innerText = transcriptStr || "Listening for speech...";
    };

    try { appState.liveRecognition.start(); } catch(e){}
}

async function processRecordedAudioBlob(audioBlob) {
    showProcessingOverlay("Transcribing Recorded Audio with Whisper AI...");

    const file = new File([audioBlob], `recording_${Date.now()}.webm`, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", `Live Recording ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`);
    formData.append("model_name", document.getElementById("whisperModelSelect").value);

    try {
        const res = await fetch(`${API_BASE}/upload-audio`, {
            method: "POST",
            body: formData
        });

        if (!res.ok) throw new Error("Server audio processing failed.");

        const meetingData = await res.json();
        hideProcessingOverlay();
        loadMeetingIntoWorkspace(meetingData);
    } catch (err) {
        hideProcessingOverlay();
        alert("Audio processing failed: " + err.message);
    }
}

/* ==========================================================================
   File Upload Handling
   ========================================================================== */

function setupDropzone() {
    const dropzone = document.getElementById("dropzone");
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add("drag-over");
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove("drag-over");
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            setSelectedAudioFile(files[0]);
        }
    });
}

function triggerFileInput() {
    document.getElementById("audioFileInput").click();
}

function handleFileSelected(event) {
    const files = event.target.files;
    if (files.length > 0) {
        setSelectedAudioFile(files[0]);
    }
}

function setSelectedAudioFile(file) {
    appState.selectedAudioFile = file;
    const dropContent = document.querySelector(".dropzone-content");
    dropContent.innerHTML = `
        <i class="fa-solid fa-file-circle-check drop-icon" style="color:#10b981;"></i>
        <h4>${file.name}</h4>
        <p>Size: ${(file.size / (1024 * 1024)).toFixed(2)} MB</p>
    `;
    document.getElementById("btnProcessUpload").disabled = false;
}

async function processFileUpload() {
    if (!appState.selectedAudioFile) return;

    showProcessingOverlay("Transcribing Uploaded File with Whisper AI...");

    const formData = new FormData();
    formData.append("file", appState.selectedAudioFile);
    formData.append("title", document.getElementById("meetingTitleInput").value);
    formData.append("model_name", document.getElementById("whisperModelSelect").value);

    try {
        const res = await fetch(`${API_BASE}/upload-audio`, {
            method: "POST",
            body: formData
        });

        if (!res.ok) throw new Error("Audio upload failed.");

        const meetingData = await res.json();
        hideProcessingOverlay();
        loadMeetingIntoWorkspace(meetingData);
    } catch (err) {
        hideProcessingOverlay();
        alert("Failed to process file: " + err.message);
    }
}

/* ==========================================================================
   Pasted Text Transcript Handling
   ========================================================================== */

function openTextPasteModal() {
    document.getElementById("textPasteModal").classList.remove("hidden");
}

function closeTextPasteModal() {
    document.getElementById("textPasteModal").classList.add("hidden");
}

async function submitPastedText() {
    const title = document.getElementById("pasteTitleInput").value;
    const text = document.getElementById("pasteTextInput").value;

    if (!text.trim()) {
        alert("Please enter transcript text.");
        return;
    }

    closeTextPasteModal();
    showProcessingOverlay("Analyzing Transcript with NLP Engine...");

    try {
        const res = await fetch(`${API_BASE}/analyze-text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title, transcript: text })
        });

        if (!res.ok) throw new Error("Failed to process text.");

        const meetingData = await res.json();
        hideProcessingOverlay();
        loadMeetingIntoWorkspace(meetingData);
    } catch (err) {
        hideProcessingOverlay();
        alert("Failed to analyze transcript: " + err.message);
    }
}

/* ==========================================================================
   Workspace Render & Interactive Audio Sync
   ========================================================================== */

function loadMeetingIntoWorkspace(meeting) {
    appState.currentMeeting = meeting;
    switchView("workspaceView");

    // Header metadata
    document.getElementById("wsMeetingId").innerText = `ID: ${meeting.id.toUpperCase()}`;
    document.getElementById("wsMeetingTitle").innerText = meeting.title;
    document.getElementById("wsMeetingDate").innerHTML = `<i class="fa-regular fa-calendar-check"></i> ${meeting.created_at}`;

    const durMins = Math.floor(meeting.duration_seconds / 60);
    const durSecs = Math.floor(meeting.duration_seconds % 60);
    document.getElementById("wsDuration").innerText = `${String(durMins).padStart(2,'0')}:${String(durSecs).padStart(2,'0')}`;
    document.getElementById("wsActionCount").innerText = `${meeting.action_points.length} Tasks`;
    document.getElementById("wsSentiment").innerText = meeting.analytics.sentiment || "Neutral";
    document.getElementById("wsWPM").innerText = `${meeting.analytics.speaking_rate_wpm || 140} WPM`;

    // Setup Audio Player
    const player = document.getElementById("meetingAudioPlayer");
    if (meeting.audio_filename) {
        player.src = `http://localhost:8000/uploads/${meeting.audio_filename}`;
        document.getElementById("audioPlayerContainer").style.display = "block";
    } else {
        document.getElementById("audioPlayerContainer").style.display = "none";
    }

    // Populate Transcript
    renderTranscriptSegments(meeting.segments);
    populateSpeakerFilter(meeting.speakers || ["Speaker 1"]);

    // Populate Insights Tabs
    renderExecutiveSummary(meeting.summary);
    renderActionItems(meeting.action_points);
    renderAnalytics(meeting.analytics);
}

function renderTranscriptSegments(segments) {
    const container = document.getElementById("transcriptStream");
    container.innerHTML = "";

    if (!segments || segments.length === 0) {
        container.innerHTML = `<p class="text-muted">No transcript segments available.</p>`;
        return;
    }

    segments.forEach((seg, idx) => {
        const startSec = seg.start || 0;
        const mins = String(Math.floor(startSec / 60)).padStart(2, '0');
        const secs = String(Math.floor(startSec % 60)).padStart(2, '0');

        const segDiv = document.createElement("div");
        segDiv.className = "transcript-segment";
        segDiv.setAttribute("data-speaker", seg.speaker || "Speaker 1");
        segDiv.innerHTML = `
            <div class="seg-meta">
                <span class="seg-speaker"><i class="fa-solid fa-user-tie"></i> ${seg.speaker || 'Speaker 1'}</span>
                <span class="timestamp-tag" onclick="seekAudioTo(${startSec})"><i class="fa-solid fa-play"></i> ${mins}:${secs}</span>
            </div>
            <p class="seg-text">${escapeHtml(seg.text)}</p>
        `;
        container.appendChild(segDiv);
    });
}

function seekAudioTo(seconds) {
    const player = document.getElementById("meetingAudioPlayer");
    if (player && player.src) {
        player.currentTime = seconds;
        player.play();
    }
}

function populateSpeakerFilter(speakers) {
    const select = document.getElementById("speakerFilterSelect");
    select.innerHTML = `<option value="ALL">All Speakers</option>`;
    speakers.forEach(spk => {
        const opt = document.createElement("option");
        opt.value = spk;
        opt.innerText = spk;
        select.appendChild(opt);
    });
}

function filterSpeakerSegments() {
    const filter = document.getElementById("speakerFilterSelect").value;
    document.querySelectorAll(".transcript-segment").forEach(seg => {
        if (filter === "ALL" || seg.getAttribute("data-speaker") === filter) {
            seg.style.display = "block";
        } else {
            seg.style.display = "none";
        }
    });
}

function filterTranscriptText() {
    const query = document.getElementById("transcriptSearchInput").value.toLowerCase();
    document.querySelectorAll(".transcript-segment").forEach(seg => {
        const text = seg.innerText.toLowerCase();
        seg.style.display = text.includes(query) ? "block" : "none";
    });
}

/* ==========================================================================
   AI Insights Tabs Render
   ========================================================================== */

function switchInsightTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(pane => pane.classList.remove("active"));

    event.currentTarget.classList.add("active");
    const pane = document.getElementById(tabId);
    if (pane) pane.classList.add("active");
}

function renderExecutiveSummary(summary) {
    document.getElementById("execSummaryContent").innerText = summary.executive_summary || "Summary not generated.";

    const takeawaysUl = document.getElementById("takeawaysList");
    takeawaysUl.innerHTML = "";
    (summary.key_takeaways || []).forEach(tk => {
        const li = document.createElement("li");
        li.innerText = tk;
        takeawaysUl.appendChild(li);
    });

    const decisionsDiv = document.getElementById("decisionsList");
    decisionsDiv.innerHTML = "";
    (summary.key_decisions || []).forEach(dec => {
        const div = document.createElement("div");
        div.innerHTML = `<i class="fa-solid fa-check-double" style="color:#10b981;"></i> <span>${escapeHtml(dec)}</span>`;
        decisionsDiv.appendChild(div);
    });
}

function renderActionItems(actionPoints) {
    const container = document.getElementById("actionItemsContainer");
    container.innerHTML = "";

    if (!actionPoints || actionPoints.length === 0) {
        container.innerHTML = `<p class="text-muted">No action points identified.</p>`;
        return;
    }

    actionPoints.forEach((ap, idx) => {
        const prioClass = ap.priority === "High" ? "priority-high" : (ap.priority === "Medium" ? "priority-medium" : "priority-normal");

        const card = document.createElement("div");
        card.className = "action-card";
        card.innerHTML = `
            <div class="action-left">
                <input type="checkbox" class="task-checkbox" ${ap.completed ? 'checked' : ''} onchange="toggleActionCompleted(${idx})">
                <span class="task-title ${ap.completed ? 'completed' : ''}">${escapeHtml(ap.task)}</span>
            </div>
            <div class="action-meta">
                <span class="priority-pill ${prioClass}">${ap.priority || 'Normal'}</span>
                <span class="assignee-badge"><i class="fa-solid fa-user"></i> ${ap.assignee || 'Unassigned'}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

async function toggleActionCompleted(index) {
    if (!appState.currentMeeting) return;
    appState.currentMeeting.action_points[index].completed = !appState.currentMeeting.action_points[index].completed;
    renderActionItems(appState.currentMeeting.action_points);

    // Sync backend DB
    try {
        await fetch(`${API_BASE}/meetings/${appState.currentMeeting.id}/action-points`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action_points: appState.currentMeeting.action_points })
        });
    } catch (err) {
        console.error("Failed to sync action item status:", err);
    }
}

function renderAnalytics(analytics) {
    // Keywords tag cloud
    const cloud = document.getElementById("keywordCloud");
    cloud.innerHTML = "";
    (analytics.keywords || []).forEach(kw => {
        const span = document.createElement("span");
        span.className = "keyword-tag";
        span.innerText = kw;
        cloud.appendChild(span);
    });

    // Speaker bars
    const statsContainer = document.getElementById("speakerStatsContainer");
    statsContainer.innerHTML = "";
    (analytics.speaker_stats || []).forEach(spk => {
        const row = document.createElement("div");
        row.className = "speaker-bar-row";
        row.innerHTML = `
            <div class="speaker-bar-info">
                <span><i class="fa-solid fa-user-tie"></i> ${spk.speaker}</span>
                <span>${spk.share_percentage}% (${spk.word_count} words)</span>
            </div>
            <div class="bar-bg">
                <div class="bar-fill" style="width: ${spk.share_percentage}%;"></div>
            </div>
        `;
        statsContainer.appendChild(row);
    });
}

/* ==========================================================================
   Meeting History Archive
   ========================================================================== */

async function fetchMeetingHistory() {
    try {
        const res = await fetch(`${API_BASE}/meetings`);
        if (!res.ok) return;
        appState.savedMeetings = await res.json();

        // Update badge count
        let totalActions = 0;
        appState.savedMeetings.forEach(m => totalActions += (m.action_count || 0));
        document.getElementById("globalActionCount").innerText = totalActions;

        renderHistoryGrid(appState.savedMeetings);
    } catch (err) {
        console.error("Error fetching history:", err);
    }
}

function renderHistoryGrid(meetings) {
    const container = document.getElementById("historyGridContainer");
    container.innerHTML = "";

    if (!meetings || meetings.length === 0) {
        container.innerHTML = `<div class="glass-card" style="grid-column: 1/-1; text-align:center; padding:40px;"><i class="fa-solid fa-folder-open" style="font-size:36px; color:var(--text-muted); margin-bottom:12px;"></i><p>No saved meetings found. Start a new recording above!</p></div>`;
        return;
    }

    meetings.forEach(m => {
        const card = document.createElement("div");
        card.className = "glass-card history-card";
        card.onclick = () => openMeetingDetails(m.id);

        card.innerHTML = `
            <div class="history-card-header">
                <span class="meeting-id-pill">${m.created_at}</span>
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); deleteMeetingRecord('${m.id}')"><i class="fa-solid fa-trash"></i></button>
            </div>
            <h4>${escapeHtml(m.title)}</h4>
            <p class="history-snippet">${escapeHtml(m.snippet)}</p>
            <div class="history-footer">
                <span style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-list-check"></i> ${m.action_count} Tasks</span>
                <span class="priority-pill priority-normal">${m.sentiment || 'Neutral'}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

async function openMeetingDetails(meetingId) {
    showProcessingOverlay("Loading Meeting Details...");
    try {
        const res = await fetch(`${API_BASE}/meetings/${meetingId}`);
        if (!res.ok) throw new Error("Meeting record not found.");
        const meetingData = await res.json();
        hideProcessingOverlay();
        loadMeetingIntoWorkspace(meetingData);
    } catch (err) {
        hideProcessingOverlay();
        alert("Failed to load meeting: " + err.message);
    }
}

async function deleteMeetingRecord(meetingId) {
    if (!confirm("Are you sure you want to delete this meeting?")) return;
    try {
        await fetch(`${API_BASE}/meetings/${meetingId}`, { method: "DELETE" });
        fetchMeetingHistory();
    } catch (err) {
        alert("Failed to delete meeting.");
    }
}

function filterHistoryCards() {
    const query = document.getElementById("historySearchInput").value.toLowerCase();
    const filtered = appState.savedMeetings.filter(m => 
        m.title.toLowerCase().includes(query) || 
        m.snippet.toLowerCase().includes(query)
    );
    renderHistoryGrid(filtered);
}

function renderGlobalActionItems() {
    const container = document.getElementById("globalActionItemsContainer");
    container.innerHTML = "";

    let allTasks = [];
    appState.savedMeetings.forEach(m => {
        // Fetch detailed if needed
    });
    container.innerHTML = `<p class="text-muted" style="padding:20px;">Master tasks aggregated across all meetings listed in meeting details.</p>`;
}

/* ==========================================================================
   Export Functionality
   ========================================================================== */

function exportMeeting(format) {
    if (!appState.currentMeeting) return;
    const m = appState.currentMeeting;

    if (format === 'json') {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(m, null, 2));
        downloadFile(dataStr, `${m.title.replace(/\W+/g, '_')}.json`);
    } else if (format === 'markdown') {
        let md = `# ${m.title}\n**Date:** ${m.created_at}\n**Duration:** ${m.duration_seconds}s\n\n`;
        md += `## Executive Summary\n${m.summary.executive_summary}\n\n`;
        md += `## Key Takeaways\n` + m.summary.key_takeaways.map(t => `- ${t}`).join('\n') + `\n\n`;
        md += `## Action Points\n` + m.action_points.map(a => `- [${a.completed ? 'x' : ' '}] ${a.task} (Assignee: ${a.assignee}, Priority: ${a.priority})`).join('\n') + `\n\n`;
        md += `## Full Transcript\n${m.transcript}\n`;
        
        const dataStr = "data:text/markdown;charset=utf-8," + encodeURIComponent(md);
        downloadFile(dataStr, `${m.title.replace(/\W+/g, '_')}.md`);
    } else if (format === 'pdf') {
        window.print();
    }
}

function downloadFile(dataUri, fileName) {
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataUri);
    dlAnchor.setAttribute("download", fileName);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
}

/* ==========================================================================
   Helpers
   ========================================================================== */

function showProcessingOverlay(stepText) {
    document.getElementById("processingStepText").innerText = stepText;
    document.getElementById("processingOverlay").classList.remove("hidden");
}

function hideProcessingOverlay() {
    document.getElementById("processingOverlay").classList.add("hidden");
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

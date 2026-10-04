import os
import uuid
import shutil
from datetime import datetime
from typing import Dict, List, Any, Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from . import database
from . import whisper_stt
from . import nlp_processor

# Define directory paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
os.makedirs(UPLOADS_DIR, exist_ok=True)

app = FastAPI(
    title="AI Voice-to-Text Meeting Assistant API",
    description="Speech-to-text transcription, NLP summary, and action items extraction API.",
    version="1.0.0"
)

# Enable CORS for local web interface
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded audio files statically
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

class TextAnalysisRequest(BaseModel):
    title: Optional[str] = "Pasted Meeting Notes"
    transcript: str
    duration_seconds: Optional[float] = 0.0

class ActionPointsUpdateRequest(BaseModel):
    action_points: List[Dict[str, Any]]

@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "whisper_available": whisper_stt._WHISPER_AVAILABLE,
        "whisper_error": whisper_stt._WHISPER_ERROR
    }

@app.post("/api/upload-audio")
async def upload_audio(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    model_name: Optional[str] = Form("base")
):
    """
    Accepts an audio file upload, transcribes with Whisper/Fallback, runs NLP analysis, and saves to DB.
    """
    try:
        meeting_id = f"mtg_{uuid.uuid4().hex[:10]}"
        timestamp_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Save file locally
        file_ext = os.path.splitext(file.filename)[1].lower() or ".webm"
        saved_filename = f"{meeting_id}{file_ext}"
        saved_file_path = os.path.join(UPLOADS_DIR, saved_filename)
        
        with open(saved_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        meeting_title = title if (title and title.strip()) else f"Meeting {datetime.now().strftime('%b %d, %H:%M')}"

        # 1. Speech-to-Text
        transcript, segments, duration = whisper_stt.transcribe_audio_file(saved_file_path, model_name)

        # 2. NLP Analysis (Summary, Action Points, Analytics)
        analysis_result = nlp_processor.analyze_meeting_transcript(transcript, segments, duration)

        # 3. Save to Database
        saved_record = database.save_meeting(
            meeting_id=meeting_id,
            title=meeting_title,
            created_at=timestamp_str,
            duration_seconds=duration,
            audio_filename=saved_filename,
            transcript=transcript,
            segments=segments,
            summary=analysis_result["summary"],
            action_points=analysis_result["action_points"],
            analytics=analysis_result["analytics"],
            speakers=list({s.get("speaker", "Speaker 1") for s in segments})
        )

        return saved_record

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process meeting audio: {str(e)}")

@app.post("/api/analyze-text")
async def analyze_text(request: TextAnalysisRequest):
    """
    Analyzes pasted or streamed text transcript directly without audio upload.
    """
    try:
        meeting_id = f"mtg_{uuid.uuid4().hex[:10]}"
        timestamp_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        transcript = request.transcript.strip()

        if not transcript:
            raise HTTPException(status_code=400, detail="Transcript text cannot be empty.")

        # Create basic sentence segments
        sentences = [s.strip() for s in transcript.split(".") if s.strip()]
        segments = []
        est_duration = max(request.duration_seconds or (len(transcript.split()) * 0.4), 10.0)
        
        step = est_duration / max(len(sentences), 1)
        for idx, s in enumerate(sentences):
            segments.append({
                "id": idx,
                "start": round(idx * step, 2),
                "end": round((idx + 1) * step, 2),
                "text": s + ".",
                "speaker": "Speaker 1" if idx % 2 == 0 else "Speaker 2",
                "confidence": 0.95
            })

        # Run NLP Analysis
        analysis_result = nlp_processor.analyze_meeting_transcript(transcript, segments, est_duration)

        # Save to DB
        saved_record = database.save_meeting(
            meeting_id=meeting_id,
            title=request.title or f"Meeting Notes {datetime.now().strftime('%b %d, %H:%M')}",
            created_at=timestamp_str,
            duration_seconds=est_duration,
            audio_filename=None,
            transcript=transcript,
            segments=segments,
            summary=analysis_result["summary"],
            action_points=analysis_result["action_points"],
            analytics=analysis_result["analytics"],
            speakers=["Speaker 1", "Speaker 2"]
        )

        return saved_record

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to analyze text: {str(e)}")

@app.get("/api/meetings")
def list_meetings():
    """Returns list of all saved meetings."""
    return database.get_all_meetings()

@app.get("/api/meetings/{meeting_id}")
def get_meeting_details(meeting_id: str):
    """Returns full meeting details including transcript, segments, summary, and action items."""
    meeting = database.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return meeting

@app.patch("/api/meetings/{meeting_id}/action-points")
def update_action_items(meeting_id: str, payload: ActionPointsUpdateRequest):
    """Updates action points state for a meeting."""
    success = database.update_action_points(meeting_id, payload.action_points)
    if not success:
        raise HTTPException(status_code=404, detail="Meeting not found or action items update failed.")
    return {"status": "success", "action_points": payload.action_points}

@app.delete("/api/meetings/{meeting_id}")
def delete_meeting_record(meeting_id: str):
    """Deletes meeting record and associated audio file."""
    meeting = database.get_meeting(meeting_id)
    if meeting and meeting.get("audio_filename"):
        audio_path = os.path.join(UPLOADS_DIR, meeting["audio_filename"])
        if os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception:
                pass
                
    success = database.delete_meeting(meeting_id)
    if not success:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return {"status": "deleted", "id": meeting_id}

@app.websocket("/ws/live-audio")
async def websocket_live_audio(websocket: WebSocket):
    """
    WebSocket endpoint for real-time live audio/transcript stream handling.
    """
    await websocket.accept()
    logger_ws_session = f"ws_{uuid.uuid4().hex[:6]}"
    print(f"WebSocket client connected: {logger_ws_session}")
    
    try:
        while True:
            data = await websocket.receive_text()
            # Respond with acknowledgment / ping heartbeat
            await websocket.send_json({"status": "received", "timestamp": datetime.now().isoformat()})
    except WebSocketDisconnect:
        print(f"WebSocket client disconnected: {logger_ws_session}")

# Serve frontend static assets
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

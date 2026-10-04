import os
import math
import logging
from typing import Dict, List, Any, Tuple

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whisper_stt")

# Global model cache to avoid re-loading model on every request
_WHISPER_MODEL = None
_WHISPER_AVAILABLE = False
_WHISPER_ERROR = None

try:
    import whisper
    import torch
    # Try testing basic torch tensor allocation to detect DLL failure early
    _dummy = torch.tensor([1.0])
    _WHISPER_AVAILABLE = True
    logger.info("OpenAI Whisper and PyTorch successfully initialized.")
except Exception as e:
    _WHISPER_AVAILABLE = False
    _WHISPER_ERROR = str(e)
    logger.warning(f"Whisper/PyTorch not available or failed to load: {e}. Fallback STT will be used.")

import speech_recognition as sr
from pydub import AudioSegment

def get_whisper_model(model_name: str = "base"):
    global _WHISPER_MODEL
    if not _WHISPER_AVAILABLE:
        return None
    if _WHISPER_MODEL is None:
        try:
            logger.info(f"Loading Whisper model '{model_name}' on CPU...")
            _WHISPER_MODEL = whisper.load_model(model_name, device="cpu")
            logger.info("Whisper model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            return None
    return _WHISPER_MODEL

def transcribe_audio_file(file_path: str, model_name: str = "base") -> Tuple[str, List[Dict[str, Any]], float]:
    """
    Transcribes an audio file.
    Returns a tuple: (full_transcript_text, segments_list, duration_seconds)
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    # Determine audio duration using pydub or soundfile
    duration_seconds = 0.0
    try:
        audio = AudioSegment.from_file(file_path)
        duration_seconds = round(len(audio) / 1000.0, 2)
    except Exception as e:
        logger.warning(f"Could not determine exact audio duration with pydub: {e}")
        duration_seconds = 10.0  # Fallback estimate

    # Try Whisper first if available
    model = get_whisper_model(model_name)
    if model is not None:
        try:
            logger.info(f"Transcribing {file_path} using Whisper ({model_name})...")
            result = model.transcribe(file_path, fp16=False)
            
            full_text = result.get("text", "").strip()
            raw_segments = result.get("segments", [])
            
            formatted_segments = []
            current_speaker = "Speaker 1"
            
            for idx, seg in enumerate(raw_segments):
                # Simple speaker heuristic based on pauses > 1.5s
                if idx > 0:
                    prev_end = raw_segments[idx-1].get("end", 0.0)
                    curr_start = seg.get("start", 0.0)
                    if curr_start - prev_end > 1.8:
                        # Alternate speaker on long pause
                        current_speaker = "Speaker 2" if current_speaker == "Speaker 1" else "Speaker 1"

                formatted_segments.append({
                    "id": idx,
                    "start": round(seg.get("start", 0.0), 2),
                    "end": round(seg.get("end", 0.0), 2),
                    "text": seg.get("text", "").strip(),
                    "speaker": current_speaker,
                    "confidence": round(float(seg.get("confidence", 0.92 if seg.get("no_speech_prob", 0) < 0.1 else 0.7)), 2)
                })
                
            if not formatted_segments and full_text:
                formatted_segments = [{
                    "id": 0,
                    "start": 0.0,
                    "end": duration_seconds,
                    "text": full_text,
                    "speaker": "Speaker 1",
                    "confidence": 0.95
                }]

            return full_text, formatted_segments, duration_seconds

        except Exception as e:
            logger.error(f"Whisper transcription failed at runtime: {e}. Falling back to SpeechRecognition.")

    # Fallback STT using SpeechRecognition / Google STT engine / chunking
    return transcribe_with_speech_recognition(file_path, duration_seconds)

def transcribe_with_speech_recognition(file_path: str, duration_seconds: float) -> Tuple[str, List[Dict[str, Any]], float]:
    """
    Fallback transcription method using SpeechRecognition library and pydub audio chunking.
    """
    logger.info(f"Transcribing {file_path} using SpeechRecognition fallback engine...")
    r = sr.Recognizer()
    
    # Convert file to WAV if needed
    try:
        audio = AudioSegment.from_file(file_path)
    except Exception as e:
        logger.error(f"Failed to read audio file for SpeechRecognition: {e}")
        return ("Audio file format could not be decoded.", [], 0.0)

    # Chunk audio into ~10-second segments for timestamping
    chunk_len_ms = 10000
    chunks = [audio[i:i + chunk_len_ms] for i in range(0, len(audio), chunk_len_ms)]
    
    segments = []
    full_text_parts = []
    current_speaker = "Speaker 1"
    
    temp_dir = os.path.join(os.path.dirname(file_path), "temp_chunks")
    os.makedirs(temp_dir, exist_ok=True)

    for idx, chunk in enumerate(chunks):
        start_sec = round((idx * chunk_len_ms) / 1000.0, 2)
        end_sec = round(min(((idx + 1) * chunk_len_ms) / 1000.0, duration_seconds), 2)
        
        chunk_file = os.path.join(temp_dir, f"chunk_{idx}.wav")
        chunk.export(chunk_file, format="wav")
        
        chunk_text = ""
        try:
            with sr.AudioFile(chunk_file) as source:
                audio_data = r.record(source)
                try:
                    chunk_text = r.recognize_google(audio_data)
                except sr.UnknownValueError:
                    chunk_text = ""
                except sr.RequestError as req_err:
                    logger.warning(f"Google Speech Recognition service request error: {req_err}")
                    chunk_text = ""
        except Exception as chunk_ex:
            logger.warning(f"Error processing audio chunk {idx}: {chunk_ex}")
            
        if os.path.exists(chunk_file):
            try:
                os.remove(chunk_file)
            except Exception:
                pass
                
        if chunk_text.strip():
            full_text_parts.append(chunk_text.strip())
            segments.append({
                "id": len(segments),
                "start": start_sec,
                "end": end_sec,
                "text": chunk_text.strip(),
                "speaker": current_speaker,
                "confidence": 0.88
            })
            # Heuristic speaker shift every 30 seconds
            if idx % 3 == 2:
                current_speaker = "Speaker 2" if current_speaker == "Speaker 1" else "Speaker 1"

    full_transcript = " ".join(full_text_parts).strip()
    if not full_transcript:
        full_transcript = "No clear speech could be recognized in the provided audio recording."
        segments = [{
            "id": 0,
            "start": 0.0,
            "end": duration_seconds,
            "text": full_transcript,
            "speaker": "Speaker 1",
            "confidence": 0.50
        }]
        
    return full_transcript, segments, duration_seconds

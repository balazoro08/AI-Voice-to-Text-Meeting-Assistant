# AI Voice-to-Text Meeting Assistant (AuraNote AI)

An AI-powered Voice-to-Text Meeting Assistant built with Python, FastAPI, Whisper Speech-to-Text, NLP Transformers, and a modern interactive web frontend.

## Features

- **Live Microphone Recorder**: Web Audio API canvas visualizer, recording timer, and real-time speech stream ticker.
- **Audio Upload Studio**: Upload `.wav`, `.mp3`, `.m4a`, `.webm` meeting recordings.
- **Whisper Speech Recognition**: Converts meeting speech to timestamped transcripts with speaker diarization/tags.
- **NLP Meeting Summarization**: Generates Executive Summaries, Key Takeaways, Key Decisions, and Sentiment analysis.
- **Action Points Board**: Auto-detects tasks, priority levels, deadlines, and assigned owners.
- **Interactive Workspace**: Click transcript timestamps to jump audio playback to exact moments.
- **Export Reports**: Export meeting summaries to PDF, Markdown (`.md`), JSON, or Plain Text.

## Technologies Used

- **Backend**: Python 3.13, FastAPI, Uvicorn, SQLite
- **Speech-to-Text**: OpenAI Whisper, SpeechRecognition
- **NLP & Transformers**: NLTK, TextBlob, Scikit-Learn
- **Frontend**: HTML5, Vanilla CSS3 (Glassmorphism, Dark Theme), JavaScript (Web Audio API, Canvas, MediaRecorder)


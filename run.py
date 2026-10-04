import os
import sys
import time
import webbrowser
import uvicorn

def main():
    print("=" * 65)
    print("  Starting AI Voice-to-Text Meeting Assistant (AuraNote AI)")
    print("=" * 65)
    
    # Ensure current directory is in sys.path
    project_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, project_dir)

    print("[1/2] Checking database and backend models...")
    from backend import database, whisper_stt, nlp_processor
    database.init_db()
    print("      [+] Database initialized.")
    print("      [+] Whisper STT available:", whisper_stt._WHISPER_AVAILABLE)
    
    # Open browser after a slight delay
    def open_browser():
        time.sleep(1.5)
        webbrowser.open("http://localhost:8000")
        print("      [+] Opened application UI at http://localhost:8000")

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    print("[2/2] Launching Web Server on http://localhost:8000 ...")
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False, log_level="info")

if __name__ == "__main__":
    main()

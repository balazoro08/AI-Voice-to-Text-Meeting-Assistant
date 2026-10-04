import sqlite3
import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Any

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "meetings.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create Meetings table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS meetings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            duration_seconds REAL DEFAULT 0,
            audio_filename TEXT,
            transcript TEXT NOT NULL,
            segments_json TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            action_points_json TEXT NOT NULL,
            analytics_json TEXT NOT NULL,
            speakers_json TEXT
        )
    ''')
    
    conn.commit()
    conn.close()

def save_meeting(
    meeting_id: str,
    title: str,
    created_at: str,
    duration_seconds: float,
    audio_filename: Optional[str],
    transcript: str,
    segments: List[Dict[str, Any]],
    summary: Dict[str, Any],
    action_points: List[Dict[str, Any]],
    analytics: Dict[str, Any],
    speakers: Optional[List[str]] = None
) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT OR REPLACE INTO meetings 
        (id, title, created_at, duration_seconds, audio_filename, transcript, segments_json, summary_json, action_points_json, analytics_json, speakers_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        meeting_id,
        title,
        created_at,
        duration_seconds,
        audio_filename,
        transcript,
        json.dumps(segments, ensure_ascii=False),
        json.dumps(summary, ensure_ascii=False),
        json.dumps(action_points, ensure_ascii=False),
        json.dumps(analytics, ensure_ascii=False),
        json.dumps(speakers or ["Speaker 1"], ensure_ascii=False)
    ))
    
    conn.commit()
    conn.close()
    
    return get_meeting(meeting_id)

def get_all_meetings() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, title, created_at, duration_seconds, audio_filename, transcript, summary_json, action_points_json, analytics_json FROM meetings ORDER BY created_at DESC')
    rows = cursor.fetchall()
    
    results = []
    for r in rows:
        summary_obj = json.loads(r["summary_json"]) if r["summary_json"] else {}
        action_points_obj = json.loads(r["action_points_json"]) if r["action_points_json"] else []
        analytics_obj = json.loads(r["analytics_json"]) if r["analytics_json"] else {}
        results.append({
            "id": r["id"],
            "title": r["title"],
            "created_at": r["created_at"],
            "duration_seconds": r["duration_seconds"],
            "audio_filename": r["audio_filename"],
            "snippet": r["transcript"][:150] + ("..." if len(r["transcript"]) > 150 else ""),
            "executive_summary": summary_obj.get("executive_summary", ""),
            "action_count": len(action_points_obj),
            "sentiment": analytics_obj.get("sentiment", "Neutral")
        })
        
    conn.close()
    return results

def get_meeting(meeting_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM meetings WHERE id = ?', (meeting_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return None
        
    return {
        "id": row["id"],
        "title": row["title"],
        "created_at": row["created_at"],
        "duration_seconds": row["duration_seconds"],
        "audio_filename": row["audio_filename"],
        "transcript": row["transcript"],
        "segments": json.loads(row["segments_json"]),
        "summary": json.loads(row["summary_json"]),
        "action_points": json.loads(row["action_points_json"]),
        "analytics": json.loads(row["analytics_json"]),
        "speakers": json.loads(row["speakers_json"]) if row["speakers_json"] else ["Speaker 1"]
    }

def update_action_points(meeting_id: str, action_points: List[Dict[str, Any]]) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE meetings SET action_points_json = ? WHERE id = ?', (json.dumps(action_points, ensure_ascii=False), meeting_id))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0

def delete_meeting(meeting_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM meetings WHERE id = ?', (meeting_id,))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0

# Initialize DB on module load
init_db()

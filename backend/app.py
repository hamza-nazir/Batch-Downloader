from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp
import os
import uuid
import time
import threading
import re
from pathlib import Path

app = Flask(__name__)
CORS(app, expose_headers=['Content-Disposition', 'X-Progress'])

DOWNLOAD_FOLDER = "/tmp/downloads"
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

# Store download progress globally (for demo purposes - use Redis/DB in production)
download_progress = {}

# Auto delete old files
def auto_delete():
    while True:
        now = time.time()
        for f in os.listdir(DOWNLOAD_FOLDER):
            path = os.path.join(DOWNLOAD_FOLDER, f)
            if os.path.isfile(path):
                if now - os.path.getmtime(path) > 300:  # 5 minutes
                    try:
                        os.remove(path)
                        print(f"Deleted old file: {f}")
                    except Exception as e:
                        print(f"Error deleting {f}: {e}")
        time.sleep(60)

threading.Thread(target=auto_delete, daemon=True).start()

def sanitize_filename(filename):
    """Remove invalid characters from filename"""
    # Remove any characters that aren't alphanumeric, space, dash, underscore, dot
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    # Limit length
    if len(filename) > 100:
        name, ext = os.path.splitext(filename)
        filename = name[:100-len(ext)] + ext
    return filename

def progress_hook(d):
    """Progress hook for yt-dlp"""
    if d['status'] == 'downloading':
        try:
            total = d.get('total_bytes', 0) or d.get('total_bytes_estimate', 0)
            downloaded = d.get('downloaded_bytes', 0)
            if total > 0:
                percent = (downloaded / total) * 100
                download_id = d.get('info_dict', {}).get('id', 'unknown')
                download_progress[download_id] = percent
        except:
            pass

@app.route("/", methods=["GET"])
def home():
    return jsonify({"message": "Batch Video Downloader API"})

@app.route("/download", methods=["POST"])
def download():
    """Single video download endpoint"""
    data = request.json
    url = data.get("url")
    
    if not url:
        return jsonify({"message": "No URL provided"}), 400
    
    file_id = str(uuid.uuid4())
    
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'outtmpl': os.path.join(DOWNLOAD_FOLDER, f'{file_id}.%(ext)s'),
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'progress_hooks': [progress_hook],
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            
            # Get the actual filename with extension
            if not os.path.exists(filename):
                # Try to find the file with different extension
                base = os.path.splitext(filename)[0]
                for ext in ['.mp4', '.webm', '.mkv']:
                    test_file = base + ext
                    if os.path.exists(test_file):
                        filename = test_file
                        break
            
            return send_file(
                filename,
                as_attachment=True,
                download_name=os.path.basename(filename),
                mimetype='video/mp4'
            )
        
    except Exception as e:
        print(f"Download error: {str(e)}")
        return jsonify({"message": "Error downloading video", "error": str(e)}), 500

@app.route("/batch-download", methods=["POST"])
def batch_download():
    """Batch download endpoint with progress tracking"""
    data = request.json
    url = data.get("url")
    
    if not url:
        return jsonify({"message": "No URL provided"}), 400
    
    file_id = str(uuid.uuid4())
    download_id = str(uuid.uuid4())
    
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'outtmpl': os.path.join(DOWNLOAD_FOLDER, f'{file_id}.%(ext)s'),
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        'progress_hooks': [progress_hook],
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Extract info first
            info = ydl.extract_info(url, download=False)
            if not info:
                return jsonify({"message": "Could not extract video info"}), 400
            
            # Get video title
            video_title = info.get('title', f'video_{file_id}')
            video_title = sanitize_filename(video_title)
            
            # Download the video
            ydl.download([url])
            
            # Find the downloaded file
            filename = ydl.prepare_filename(info)
            if not os.path.exists(filename):
                # Try different extensions
                base = os.path.splitext(filename)[0]
                for ext in ['.mp4', '.webm', '.mkv']:
                    test_file = base + ext
                    if os.path.exists(test_file):
                        filename = test_file
                        break
            
            if not os.path.exists(filename):
                return jsonify({"message": "Downloaded file not found"}), 500
            
            # Create final filename with video title
            file_extension = os.path.splitext(filename)[1]
            final_filename = f"{video_title}{file_extension}"
            final_path = os.path.join(DOWNLOAD_FOLDER, final_filename)
            
            # Rename if different
            if filename != final_path and not os.path.exists(final_path):
                os.rename(filename, final_path)
            else:
                final_path = filename
                final_filename = os.path.basename(final_path)
            
            # Send file
            response = send_file(
                final_path,
                as_attachment=True,
                download_name=final_filename,
                mimetype='video/mp4'
            )
            
            # Set filename header
            response.headers['Content-Disposition'] = f'attachment; filename="{final_filename}"'
            return response
        
    except yt_dlp.utils.DownloadError as e:
        print(f"yt-dlp error: {str(e)}")
        return jsonify({"message": "Download error - Video may be unavailable", "error": str(e)}), 500
    except Exception as e:
        print(f"Server error: {str(e)}")
        return jsonify({"message": "Server error", "error": str(e)}), 500

@app.route("/batch", methods=["POST"])
def batch_download_multiple():
    """Process multiple URLs"""
    data = request.json
    urls = data.get("urls", [])
    
    if not urls:
        return jsonify({"message": "No URLs provided"}), 400
    
    results = []
    
    for url in urls:
        file_id = str(uuid.uuid4())
        ydl_opts = {
            'format': 'best[ext=mp4]/best',
            'outtmpl': os.path.join(DOWNLOAD_FOLDER, f'{file_id}.%(ext)s'),
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filename = ydl.prepare_filename(info)
                
                # Find actual file
                if not os.path.exists(filename):
                    base = os.path.splitext(filename)[0]
                    for ext in ['.mp4', '.webm', '.mkv']:
                        test_file = base + ext
                        if os.path.exists(test_file):
                            filename = test_file
                            break
                
                video_title = sanitize_filename(info.get('title', f'video_{file_id}'))
                file_extension = os.path.splitext(filename)[1]
                final_filename = f"{video_title}{file_extension}"
                final_path = os.path.join(DOWNLOAD_FOLDER, final_filename)
                
                if filename != final_path and not os.path.exists(final_path):
                    os.rename(filename, final_path)
                
                results.append({
                    "url": url,
                    "success": True,
                    "filename": final_filename
                })
        except Exception as e:
            results.append({
                "url": url,
                "success": False,
                "error": str(e)
            })
    
    return jsonify({"results": results, "total": len(results)})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)
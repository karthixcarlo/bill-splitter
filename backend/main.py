import os
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import httpx
import base64

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="Bro please pay API",
    description="AI-powered bill splitting with Gemini Vision",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom Lightweight Gemini Client
class SimpleGeminiClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        # Using gemini-2.5-flash (verified working with this API key)
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        
    def generate_content(self, contents):
        import time
        # Determine text vs image content
        prompt_text = ""
        inline_data = None
        
        for content in contents:
            if isinstance(content, str):
                prompt_text = content
            elif isinstance(content, dict) and 'data' in content:
                # content is like {'mime_type': 'image/jpeg', 'data': bytes}
                inline_data = {
                    "mime_type": content.get('mime_type', 'image/jpeg'),
                    "data": base64.b64encode(content['data']).decode('utf-8')
                }
        
        parts = []
        if prompt_text:
            parts.append({"text": prompt_text})
        if inline_data:
            parts.append({"inline_data": inline_data})
            
        payload = {
            "contents": [{"parts": parts}]
        }
        
        url = f"{self.base_url}?key={self.api_key}"
        
        # Retry logic
        max_retries = 3
        for attempt in range(max_retries):
            with httpx.Client(timeout=30.0) as http:
                response = http.post(url, json=payload, headers={"Content-Type": "application/json"})
                
                if response.status_code == 429:
                    print(f"DEBUG: Rate limit hit (429). Retrying in {2 ** attempt}s...")
                    time.sleep(2 ** attempt)  # Exponential backoff: 1s, 2s, 4s
                    continue
                
                response.raise_for_status()
                return SimpleGeminiResponse(response.json())
        
        # If we get here, we failed after retries
        raise Exception("Gemini API Rate Limit Exceeded (429) after retries.")

class SimpleGeminiResponse:
    def __init__(self, data):
        self.data = data
        try:
            self.text = data['candidates'][0]['content']['parts'][0]['text']
        except (KeyError, IndexError):
            self.text = ""

# Initialize Gemini Client
gemini_model = None
if os.getenv("GEMINI_API_KEY"):
    gemini_model = SimpleGeminiClient(os.getenv("GEMINI_API_KEY"))

# Custom Lightweight Supabase Client
class SimpleSupabaseClient:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.key = key
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        
    def table(self, table_name: str):
        return SimpleSupabaseQueryBuilder(self, table_name)
        
    def storage(self):
        return SimpleSupabaseStorage(self)

class SimpleSupabaseQueryBuilder:
    def __init__(self, client, table_name):
        self.client = client
        self.table_url = f"{client.url}/rest/v1/{table_name}"
        self.params = {}
        
    def select(self, columns="*"):
        self.params["select"] = columns
        return self
        
    def eq(self, column, value):
        self.params[column] = f"eq.{value}"
        return self

    def in_(self, column, values):
        if isinstance(values, list):
            val_str = ",".join(str(v) for v in values)
            self.params[column] = f"in.({val_str})"
        else:
             clean_val = str(values).strip("()")
             self.params[column] = f"in.({clean_val})"
        return self
        
    def insert(self, data):
        self.method = "POST"
        self.data = data
        return self
        
    def delete(self):
        self.method = "DELETE"
        return self
        
    def execute(self):
        with httpx.Client() as http:
            if hasattr(self, 'method') and self.method == "POST":
                response = http.post(self.table_url, headers=self.client.headers, json=self.data, params=self.params)
            elif hasattr(self, 'method') and self.method == "DELETE":
                 response = http.delete(self.table_url, headers=self.client.headers, params=self.params)
            else:
                response = http.get(self.table_url, headers=self.client.headers, params=self.params)
                
            response.raise_for_status()
            class Response: pass
            r = Response()
            try: r.data = response.json()
            except: r.data = None
            return r

class SimpleSupabaseStorage:
    def __init__(self, client):
        self.client = client
        
    def from_(self, bucket_id):
        return SimpleSupabaseStorageBucket(self.client, bucket_id)

class SimpleSupabaseStorageBucket:
    def __init__(self, client, bucket_id):
        self.client = client
        self.bucket_id = bucket_id
        
    def upload(self, path, file_bytes, file_options=None):
        url = f"{self.client.url}/storage/v1/object/{self.bucket_id}/{path}"
        headers = {
            "apikey": self.client.key,
            "Authorization": f"Bearer {self.client.key}",
        }
        if file_options and "content-type" in file_options:
            headers["Content-Type"] = file_options["content-type"]
            
        with httpx.Client() as http:
            response = http.post(url, headers=headers, content=file_bytes)
            # handle existing file error gracefully or just raise
            if response.status_code != 200:
                print(f"Upload warning: {response.text}")
            return response.json() if response.status_code == 200 else {}
            
    def get_public_url(self, path):
        return f"{self.client.url}/storage/v1/object/public/{self.bucket_id}/{path}"

# Initialize Supabase client
supabase = SimpleSupabaseClient(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

# Make clients available to routers
app.state.gemini = gemini_model
app.state.supabase = supabase

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Bro please pay API",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "api": "online",
        "gemini": "configured" if app.state.gemini else "missing or failed",
        "supabase": "configured" if os.getenv("SUPABASE_URL") else "missing config"
    }

# Import and include routers
from routers import scan, bills

app.include_router(scan.router, prefix="/api", tags=["QR Scanning"])
app.include_router(bills.router, prefix="/api", tags=["Bill Parsing"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", 8000)),
        reload=True
    )

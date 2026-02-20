import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="Bill Splitter API - DEBUG MODE")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Backend is working!", "status": "ok"}

@app.get("/health")
async def health_check():
    return {
        "api": "online",
        "gemini_key_exists": bool(os.getenv("GEMINI_API_KEY")),
        "supabase_url_exists": bool(os.getenv("SUPABASE_URL"))
    }

if __name__ == "__main__":
    import uvicorn
    print("Starting simplified backend on http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

app = FastAPI(
    title="Video Editor API",
    version="0.1.0",
    description="Backend API for video editing application"
)

# Configure CORS to allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative port
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Response model
class HelloResponse(BaseModel):
    message: str
    timestamp: str
    tech_stack: dict
    fun_fact: str


@app.get("/")
async def root():
    """Root endpoint - API info"""
    return {
        "message": "Video Editor API is running! 🚀",
        "version": "0.1.0",
        "status": "healthy",
        "docs": "/docs"
    }


@app.get("/api/hello", response_model=HelloResponse)
async def hello_world():
    """
    Hello World endpoint that demonstrates:
    - FastAPI (Python web framework)
    - Pydantic (data validation)
    - Async/await support
    """
    return HelloResponse(
        message="Hello from FastAPI + Python! 🐍",
        timestamp=datetime.now().isoformat(),
        tech_stack={
            "backend": "FastAPI",
            "language": "Python 3.11+",
            "async": True,
            "validation": "Pydantic"
        },
        fun_fact="FastAPI is one of the fastest Python frameworks, thanks to Starlette and Pydantic!"
    )


@app.get("/api/status")
async def get_status():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "video-editor-api",
        "timestamp": datetime.now().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)

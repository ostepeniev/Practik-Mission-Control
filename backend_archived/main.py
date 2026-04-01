"""Practik UA Dashboard — FastAPI Backend."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from backend.database import init_db, SessionLocal
from backend.seed_data import seed_all
from backend.routers import auth, dashboard, metrics, ai, admin

app = FastAPI(
    title="Practik UA Dashboard API",
    version="1.0.0",
    description="Analytics dashboard API for Practik UA pet food company"
)

# CORS
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(metrics.router)
app.include_router(ai.router)
app.include_router(admin.router)


@app.on_event("startup")
def startup():
    """Initialize DB and seed demo data on startup."""
    init_db()
    db = SessionLocal()
    try:
        seed_all(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "practik-dashboard-api"}

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routers import admin, auth, bookings, care, clinic, exercises, health, physios, queue, records, webhooks

settings = get_settings()
logging.basicConfig(level=logging.INFO if settings.is_dev else logging.WARNING)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs" if settings.is_dev else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(physios.router)
app.include_router(bookings.router)
app.include_router(clinic.router)
app.include_router(admin.router)
app.include_router(queue.router)
app.include_router(records.router)
app.include_router(exercises.router)
app.include_router(care.router)
app.include_router(webhooks.router)

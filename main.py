from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from datetime import datetime

app = FastAPI(
    title="OrbitalGuard Triage Backend",
    description="Backend API for managing satellite telemetry and collision avoidance triage.",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Satellite(BaseModel):
    id: int
    name: str
    norad_id: str
    status: str
    altitude_km: float

class ConjunctionEvent(BaseModel):
    id: int
    satellite_name: str
    debris_name: str
    risk_level: str
    miss_distance_km: float
    time_of_closest_approach: str
    status: str

mock_satellites = [
    Satellite(id=1, name="ISS (ZARYA)", norad_id="25544", status="Active", altitude_km=420.5),
    Satellite(id=2, name="Hubble Space Telescope", norad_id="20580", status="Active", altitude_km=540.2),
]

mock_conjunctions = [
    ConjunctionEvent(
        id=1,
        satellite_name="ISS (ZARYA)",
        debris_name="COSMOS 1408 DEB",
        risk_level="High",
        miss_distance_km=0.45,
        time_of_closest_approach="2026-06-06T14:30:00Z",
        status="Pending"
    )
]

@app.get("/")
def read_root():
    return {"message": "OrbitalGuard Triage Backend is running successfully!"}

@app.get("/api/satellites", response_model=List[Satellite])
def get_satellites():
    return mock_satellites

@app.get("/api/conjunctions", response_model=List[ConjunctionEvent])
def get_conjunctions():
    return mock_conjunctions
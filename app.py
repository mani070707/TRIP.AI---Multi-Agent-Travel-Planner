import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from backend import run_travel_agent, resume_travel_agent

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="TRIP AI",
    description=(
        "LangGraph Multi-Agent Travel Planner with Supervisor, Guardrails, "
        "Human-in-the-Loop, and FastAPI Frontend"
    ),
    version="2.0.0",
)

app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static",
)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class TravelRequest(BaseModel):
    message: str = Field(max_length=4000)
    thread_id: str | None = None


class ApprovalRequest(BaseModel):
    thread_id: str = Field(min_length=1)
    approved: bool
    feedback: str = Field(default="", max_length=2000)


def _public_error(exc: Exception) -> tuple[int, str]:
    """Return a useful client message without leaking keys or provider details."""
    text = str(exc).lower()
    if "rate_limit" in text or "tokens per minute" in text or "error code: 413" in text:
        return 429, (
            "The free AI allowance is busy right now. Please wait a minute "
            "and try again; your trip details are still here."
        )
    return 500, "We couldn't finish this trip right now. Please try again shortly."


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={},
    )


@app.post("/api/travel")
def travel_planner(request_data: TravelRequest):
    try:
        user_message = request_data.message.strip()

        if not user_message:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Message cannot be empty.",
                },
            )

        result = run_travel_agent(
            user_input=user_message,
            thread_id=request_data.thread_id,
        )

        return JSONResponse(
            content={
                "success": True,
                **result,
            }
        )

    except Exception as exc:
        print(f"TRAVEL REQUEST ERROR: {type(exc).__name__}", flush=True)

        status_code, message = _public_error(exc)

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": message,
            },
        )


@app.post("/api/travel/approve")
def approve_travel_plan(request_data: ApprovalRequest):
    try:
        if not request_data.approved and not request_data.feedback.strip():
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Please provide revision feedback when rejecting the draft.",
                },
            )

        result = resume_travel_agent(
            thread_id=request_data.thread_id,
            approved=request_data.approved,
            feedback=request_data.feedback,
        )

        return JSONResponse(
            content={
                "success": True,
                **result,
            }
        )

    except Exception as exc:
        print(f"APPROVAL ERROR: {type(exc).__name__}", flush=True)

        status_code, message = _public_error(exc)

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": message,
            },
        )


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "TripMate AI API is running",
        "features": [
            "supervisor_agent",
            "input_guardrail",
            "human_in_the_loop",
        ],
    }


@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=not bool(os.getenv("RENDER")),
    )

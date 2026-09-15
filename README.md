# TRIP AI - Multi-Agent Travel Planner

TRIP AI is a production-style travel planning app built with FastAPI, LangGraph,
Groq-hosted LLM calls, MCP tools, PostgreSQL checkpoints, input guardrails, and
a human-in-the-loop review step.

The app takes a natural-language trip request, validates that it is travel
related, routes it through a supervised multi-agent workflow, gathers live or
near-live travel context through MCP servers, creates a draft itinerary, pauses
for human approval, and then either finalizes the plan or revises it with the
traveler's feedback.

## What It Does

- Plans trips from plain-language prompts such as destination, dates, budget,
  travel style, and preferences.
- Uses a LangGraph supervisor to decide which specialist agents are needed.
- Connects to external tools through MCP for web search, weather, and aviation
  information.
- Applies an input guardrail before any specialist work begins.
- Requires human approval before returning the final itinerary.
- Persists interrupted runs with PostgreSQL so approval can resume the same
  graph thread.
- Provides a FastAPI backend and a polished browser interface for planning,
  review, approval, and revision.

## Project Architecture

```text
Browser UI
templates/index.html
static/style.css
static/script.js
        |
        | POST /api/travel
        v
FastAPI App
app.py
        |
        | run_travel_agent()
        v
LangGraph Workflow
backend.py
        |
        v
+--------------------+
| Supervisor Agent   |
| - validates input  |
| - extracts intent  |
| - selects agents   |
+--------------------+
        |
        | blocked
        +------------------> Guardrail Blocked Response
        |
        | allowed
        v
+--------------------+     +--------------------+     +--------------------+
| Flight Agent       | --> | Hotel Agent        | --> | Weather Agent      |
| Aviation MCP       |     | Tavily MCP         |     | Weather MCP        |
+--------------------+     +--------------------+     +--------------------+
        |                         |                         |
        +-------------------------+-------------------------+
                                  |
                                  v
                         +--------------------+
                         | Budget Agent       |
                         | cost feasibility   |
                         +--------------------+
                                  |
                                  v
                         +--------------------+
                         | Itinerary Agent    |
                         | draft synthesis    |
                         +--------------------+
                                  |
                                  v
                         +--------------------+
                         | HITL Interrupt     |
                         | approve/revise     |
                         +--------------------+
                                  |
                                  | POST /api/travel/approve
                                  v
                         +--------------------+
                         | Final Agent        |
                         | final itinerary    |
                         +--------------------+
                                  |
                                  v
                           Browser Result

PostgreSQL Checkpointer
Stores LangGraph thread state so the interrupted approval step can be resumed.
```

## Core Components

| File | Purpose |
| --- | --- |
| `app.py` | FastAPI app, HTML serving, API routes, health check, and public error handling. |
| `backend.py` | LangGraph state, supervisor, specialist agents, guardrail, HITL interrupt, final response logic, and PostgreSQL checkpointer. |
| `mcp_client.py` | Multi-server MCP client for Tavily, AviationStack, and the custom weather server. |
| `custom_weather_mcp_server.py` | Local stdio MCP server that exposes current weather and forecast tools using OpenWeather. |
| `templates/index.html` | Main browser UI for submitting trips, reviewing drafts, and approving or requesting changes. |
| `static/script.js` | Frontend request flow, Markdown rendering, agent-flow visualization, approval, and revision handling. |
| `static/style.css` | Visual design for the travel planner interface. |
| `tests/test_frontend.py` | Frontend-focused regression tests. |
| `Dockerfile` and `render.yaml` | Container and Render deployment configuration. |

## Supervised Multi-Agent Flow

The travel workflow is built as a LangGraph state machine in `backend.py`.

1. The user submits a trip request from the browser.
2. FastAPI calls `run_travel_agent()`.
3. The supervisor agent validates the prompt, extracts trip constraints, and
   chooses the required specialist agents.
4. Selected agents run in a fixed safe order:
   `flight_agent`, `hotel_agent`, `weather_agent`, `budget_agent`,
   `itinerary_agent`.
5. The itinerary agent creates a draft Markdown plan.
6. LangGraph pauses at `human_approval_agent` with an interrupt payload.
7. The frontend shows the draft and asks the user to approve or request changes.
8. FastAPI resumes the same graph thread through `resume_travel_agent()`.
9. The final agent either returns the approved draft or revises it using the
   human feedback.

This design keeps the supervisor in control of routing while allowing each
specialist agent to focus on one part of the trip.

## MCP Tooling

TRIP AI uses MCP as the tool layer between agents and external information
sources. The MCP client is configured in `mcp_client.py` with three tool
servers:

| MCP Server | Transport | Used By | Purpose |
| --- | --- | --- | --- |
| Tavily | `streamable_http` | Hotel agent | Searches for hotels, attractions, local transport, and source links. |
| AviationStack | `stdio` | Flight agent | Looks up airport and airline information through `aviationstack-mcp`. |
| Weather | `stdio` | Weather agent | Runs the local `custom_weather_mcp_server.py` process for current weather and forecast data. |

The app loads only the requested MCP server for each tool call. That means a
failure in one provider does not automatically crash unrelated tools. When live
tool data is unavailable, the agents fall back to clearly labelled general
guidance instead of pretending that stale or live data was retrieved.

## Guardrails

The first node in the graph is the supervisor, which also acts as the input
guardrail. It checks whether the request belongs to the travel-planning domain.

Allowed requests include:

- destinations
- transport
- hotels and neighborhoods
- weather and packing
- budgets
- visas
- food
- day-by-day itineraries

Clearly unrelated, harmful, or illegal requests are blocked before specialist
agents or MCP tools run. Blocked requests return a user-facing explanation
through the `guardrail_blocked_agent`.

## Human-In-The-Loop Review

TRIP AI does not immediately publish the first generated itinerary as final.
After the itinerary agent creates a draft, LangGraph pauses with `interrupt()`.

The browser then shows:

- the draft itinerary
- the selected agent flow
- the supervisor reasoning
- an approval button
- a revision feedback form

If the user approves, the final agent returns the draft as the final plan. If
the user requests changes, the graph resumes with the feedback and the final
agent produces a revised itinerary.

## Supervised Agent Design

The supervisor controls the system instead of letting every agent run blindly.
It returns structured routing data:

- whether the request is allowed
- why it was allowed or blocked
- which specialist agents should run
- extracted trip constraints such as destination, origin, duration, budget,
  travel style, and preferences
- a short routing explanation for the UI

The UI displays this decision so the user can see how the plan was assembled.

## API Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/` | `GET` | Serves the browser UI. |
| `/api/travel` | `POST` | Starts a new travel-planning graph run. |
| `/api/travel/approve` | `POST` | Resumes a paused graph run after approval or feedback. |
| `/health` | `GET` | Returns service health and enabled features. |

## Requirements

- Python 3.13+
- PostgreSQL
- `uv` or `uvx` for the local AviationStack MCP process
- Groq API key
- Tavily API key
- OpenWeather API key
- AviationStack API key

## Environment Variables

Create a `.env` file from `.env.example` and fill in the required values:

```text
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
DATABASE_URL=
TAVILY_API_KEY=
OPENWEATHER_API_KEY=
AVIATION_STACK_API_KEY=
```

`DATABASE_URL` should point to PostgreSQL. If `sslmode` is not included, the app
adds `sslmode=require` automatically.

## Local Setup

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install uv==0.11.29
uv tool install aviationstack-mcp==1.6.0
cp .env.example .env
```

After filling in `.env`, start the app:

```bash
uvicorn app:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000
```

Health check:

```text
http://127.0.0.1:8000/health
```

## Render Deployment

The included `render.yaml` and `Dockerfile` define one Docker web service. The
weather and AviationStack MCP servers run as local subprocesses inside the same
container, so they do not require separate Render services.

1. Push the repository to GitHub without committing `.env`.
2. In Render, choose **New > Blueprint** and select this repository.
3. Enter the required secret environment values.
4. Use a PostgreSQL `DATABASE_URL`; for Render Postgres in the same region,
   prefer the internal URL.
5. Deploy and verify `/health`, trip creation, draft review, and itinerary
   approval.

The service binds to Render's `PORT` variable and uses `/health` for deployment
health checks. API secrets are excluded from both Git and the Docker build
context.

## Testing

```bash
python -m unittest discover -s tests -v
node --check static/script.js
```

## Repository Notes

- `.env` should stay local and must not be committed.
- The LangGraph checkpointer requires a working PostgreSQL database before the
  backend can compile the graph.
- MCP providers may have plan limits. When a provider is unavailable, the app
  degrades gracefully and labels the output as general guidance.

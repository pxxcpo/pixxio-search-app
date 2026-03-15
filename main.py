#!/usr/bin/env python3
"""
pixx.io Spotlight Search — FastAPI Backend
Integrates Claude API for natural language query interpretation + pixx.io MCP Server for search.
"""

import os
import json
import logging

import httpx
import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pixxio-search")

# ── Config ────────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
PIXXIO_API_KEY    = os.environ.get("PIXXIO_API_KEY", "")
PIXXIO_BASE_URL   = os.environ.get("PIXXIO_BASE_URL", "").rstrip("/")
MCP_SERVER_URL    = os.environ.get(
    "MCP_SERVER_URL",
    "https://pixxio-mcp-server-new.onrender.com/mcp"
)

app = FastAPI(title="pixx.io Spotlight Search")

# ── Claude Tool Schema ─────────────────────────────────────────────────────────
SEARCH_TOOL = {
    "name": "search_assets",
    "description": (
        "Search for assets in the pixx.io Digital Asset Management system. "
        "Extracts filter parameters from natural language queries."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Main search term (event name, topic, scene description)"
            },
            "semantic": {
                "type": "boolean",
                "description": "Use AI semantic/visual search for scene descriptions"
            },
            "file_type": {
                "type": "string",
                "enum": ["image", "video", "audio"],
                "description": "Filter by file type"
            },
            "file_extension": {
                "type": "string",
                "description": "Filter by extension: jpg, png, pdf, mp4, tiff, webp, etc."
            },
            "orientation": {
                "type": "string",
                "enum": ["landscape", "portrait", "square"]
            },
            "colorspace": {
                "type": "string",
                "enum": ["RGB", "CMYK", "GRAY"],
                "description": "Use CMYK for print assets"
            },
            "rating_min": {
                "type": "integer",
                "minimum": 1,
                "maximum": 5,
                "description": "Minimum star rating"
            },
            "person_name": {
                "type": "string",
                "description": "Person's name to filter by face recognition"
            },
            "date_from": {
                "type": "string",
                "description": "Upload date start as YYYY-MM-DD"
            },
            "date_to": {
                "type": "string",
                "description": "Upload date end as YYYY-MM-DD"
            },
            "sort_by": {
                "type": "string",
                "enum": ["uploadDate", "rating", "pixel", "fileName"],
                "description": "Sort field (default: uploadDate)"
            },
            "sort_direction": {
                "type": "string",
                "enum": ["desc", "asc"]
            },
            "page_size": {
                "type": "integer",
                "minimum": 1,
                "maximum": 50,
                "description": "Number of results (default: 20)"
            },
        },
        "required": []
    }
}

SYSTEM_PROMPT = """Du bist ein Assistent für die pixx.io DAM-Suche.
Analysiere die natürlichsprachige Suchanfrage und rufe search_assets mit den richtigen Parametern auf.

Parameter-Extraktion:
- Personen ('von Richard', 'mit Anna', 'Richard') → person_name
- Zeitangaben ('letztes Jahr' → Jahr davor, '2024', 'dieser Monat', 'letzte Woche') → date_from + date_to als YYYY-MM-DD
- Events/Themen ('Sommerfest', 'Messe', 'Produktpräsentation') → query
- Dateityp ('Bilder'/'Fotos'→image, 'Videos'→video, 'Audiodateien'→audio) → file_type
- Ausrichtung ('Querformat'→landscape, 'Hochformat'→portrait) → orientation
- Qualität ('beste', 'hochwertig', '5 Sterne') → rating_min=4 oder 5
- Druck/CMYK ('für den Druck', 'Druckdateien') → colorspace='CMYK'
- Visuelle Szenen ('rotes Auto', 'Person am Strand') → semantic=True

Heute ist 2026-03-15. Berechne Datumsbereiche präzise:
- 'letztes Jahr' → date_from='2025-01-01', date_to='2025-12-31'
- '2024' → date_from='2024-01-01', date_to='2024-12-31'
- 'diesen Monat' → date_from='2026-03-01', date_to='2026-03-31'

Rufe search_assets EINMAL auf mit allen relevanten Filtern."""


# ── MCP Server Communication ───────────────────────────────────────────────────

async def call_mcp_search(arguments: dict) -> dict:
    """Call search_assets on the MCP server via Streamable HTTP."""
    # Always disable previews — we handle thumbnails via our own proxy
    arguments = {**arguments, "include_previews": False, "page_size": min(arguments.get("page_size", 20), 20)}

    logger.info(f"Calling MCP search_assets with: {json.dumps(arguments)}")

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            MCP_SERVER_URL,
            json={
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {"name": "search_assets", "arguments": arguments},
                "id": 1,
            },
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()

    if "error" in data:
        raise ValueError(f"MCP error: {data['error']}")

    result = data.get("result", {})
    content = result.get("content", [])

    for item in content:
        if item.get("type") == "text":
            try:
                return json.loads(item["text"])
            except json.JSONDecodeError:
                pass

    # Fallback: return result directly if it looks like asset data
    return result


# ── API Endpoints ──────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str


@app.post("/api/search")
async def search(request: SearchRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # ── Step 1: Claude interprets query → tool_use block ──────────────────────
    messages = [{"role": "user", "content": request.query}]

    claude_response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=SYSTEM_PROMPT,
        tools=[SEARCH_TOOL],
        tool_choice={"type": "any"},
        messages=messages,
    )

    tool_use_block = next(
        (b for b in claude_response.content if b.type == "tool_use"), None
    )
    if not tool_use_block:
        raise HTTPException(500, "Claude did not generate a search call")

    filters_used: dict = dict(tool_use_block.input)
    logger.info(f"Claude chose filters: {json.dumps(filters_used)}")

    # ── Step 2: Call MCP server with Claude's parameters ──────────────────────
    try:
        mcp_result = await call_mcp_search(filters_used)
    except Exception as exc:
        logger.error(f"MCP call failed: {exc}")
        raise HTTPException(502, f"MCP server error: {exc}")

    results = mcp_result.get("results", [])
    total   = mcp_result.get("total_results", 0)

    # ── Step 3: Get Claude's explanation of the search ────────────────────────
    messages.append({"role": "assistant", "content": claude_response.content})
    messages.append({
        "role": "user",
        "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use_block.id,
            "content": json.dumps({
                "total_results": total,
                "results_count": len(results),
                "page": mcp_result.get("page", 1),
                "search_mode": mcp_result.get("search_mode", "standard"),
            }),
        }],
    })

    explanation_response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=256,
        system=SYSTEM_PROMPT,
        tools=[SEARCH_TOOL],
        messages=messages,
    )

    explanation = next(
        (b.text for b in explanation_response.content if hasattr(b, "text")),
        f"Ich habe {total} Ergebnisse gefunden."
    )

    # ── Add proxy preview URLs ────────────────────────────────────────────────
    for r in results:
        r["proxy_preview_url"] = f"/api/preview/{r['id']}"

    return {
        "results": results,
        "total": total,
        "search_details": {
            "tool": "search_assets",
            "filters_used": filters_used,
            "explanation": explanation,
            "search_mode": mcp_result.get("search_mode", "standard"),
        },
    }


@app.get("/api/preview/{asset_id}")
async def preview(asset_id: str):
    """Proxy pixx.io preview images server-side (no CORS/auth issues in browser)."""
    if not PIXXIO_API_KEY or not PIXXIO_BASE_URL:
        raise HTTPException(500, "pixx.io not configured")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Get signed preview URL from pixx.io
            resp = await client.get(
                f"{PIXXIO_BASE_URL}/api/v1/files/{asset_id}/convert",
                headers={"Authorization": f"Bearer {PIXXIO_API_KEY}"},
                params={"downloadType": "preview", "responseType": "path", "maxSize": 400},
            )
            resp.raise_for_status()
            data = resp.json()

            url = data.get("downloadURL") or data.get("downloadUrl") or ""
            if not url.startswith("http"):
                url = f"{PIXXIO_BASE_URL}{url}"

            # Fetch the image bytes
            img_resp = await client.get(url, follow_redirects=True)
            img_resp.raise_for_status()

            content_type = img_resp.headers.get("content-type", "image/jpeg")
            return Response(
                content=img_resp.content,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=3600"},
            )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(exc.response.status_code, f"Preview unavailable: {exc}")
    except Exception as exc:
        raise HTTPException(500, f"Preview error: {exc}")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "anthropic": bool(ANTHROPIC_API_KEY),
        "pixxio": bool(PIXXIO_API_KEY and PIXXIO_BASE_URL),
        "mcp_server": MCP_SERVER_URL,
    }


@app.get("/")
async def root():
    return FileResponse("static/index.html")


# Static files (CSS, JS) — must be last
app.mount("/static", StaticFiles(directory="static"), name="static")

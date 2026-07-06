#!/usr/bin/env python3
import hashlib

from fastapi import Body, Cookie, Depends, FastAPI, Form, HTTPException, Query, status
from fastapi.requests import Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from agent.chat import run_agent
from agent.client import AVAILABLE_MODELS
from config import AGENT_MODEL, PC_HOST, PC_MAC, UI_PASSWORD
from pc_client import send_magic_packet, ws_cmd

app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.middleware("http")
async def no_cache(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response

SESSION_TOKEN = hashlib.sha256(UI_PASSWORD.encode()).hexdigest()


def check_session(session: str | None = Cookie(default=None)) -> str:
    if session != SESSION_TOKEN:
        raise HTTPException(status_code=status.HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    return session


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(request=request, name="login.html")


@app.post("/login")
async def do_login(password: str = Form(...)):
    if password != UI_PASSWORD:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Mauvais mot de passe")
    response = RedirectResponse("/", status_code=status.HTTP_302_FOUND)
    response.set_cookie("session", SESSION_TOKEN, httponly=True, samesite="strict", secure=True)
    return response


@app.get("/logout")
async def logout():
    response = RedirectResponse("/login", status_code=status.HTTP_302_FOUND)
    response.delete_cookie("session")
    return response


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, _: str = Depends(check_session)):
    return templates.TemplateResponse(request=request, name="index.html")


@app.get("/api/status")
async def api_status(_: str = Depends(check_session)):
    return await ws_cmd({"cmd": "status"})


@app.post("/api/wake")
async def api_wake(_: str = Depends(check_session)):
    send_magic_packet()
    return {"status": "sent"}


@app.post("/api/launch")
async def api_launch(session: str = Query(default="claude"), _: str = Depends(check_session)):
    return await ws_cmd({"cmd": "launch", "session": session})


@app.post("/api/kill")
async def api_kill(session: str = Query(default="claude"), _: str = Depends(check_session)):
    return await ws_cmd({"cmd": "kill", "session": session})


@app.get("/api/sessions")
async def api_sessions(_: str = Depends(check_session)):
    return await ws_cmd({"cmd": "list_sessions"})


@app.get("/api/capture")
async def api_capture(session: str = Query(default="claude"), _: str = Depends(check_session)):
    return await ws_cmd({"cmd": "capture_pane", "session": session, "lines": 80})


@app.post("/api/send")
async def api_send(
    session: str = Query(default="claude"),
    body: dict = Body(default={}),
    _: str = Depends(check_session),
):
    keys = body.get("keys", "")
    return await ws_cmd({"cmd": "send_keys", "session": session, "keys": keys})


@app.get("/api/metrics")
async def api_metrics(_: str = Depends(check_session)):
    return await ws_cmd({"cmd": "metrics"})


@app.post("/api/agent/chat")
async def api_agent_chat(body: dict = Body(...), _: str = Depends(check_session)):
    message = body.get("message", "")
    history = body.get("history", [])
    model = body.get("model")
    return await run_agent(history, message, model)


@app.get("/api/config")
async def api_config(_: str = Depends(check_session)):
    return {"pc_host": PC_HOST, "pc_mac": PC_MAC, "default_model": AGENT_MODEL, "models": AVAILABLE_MODELS}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8766)

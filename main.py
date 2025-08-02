from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

app = FastAPI()

# Serve static files like HTML, JS, CSS
app.mount("/static", StaticFiles(directory="static"), name="static")

# Route to serve the main page
@app.get("/", response_class=HTMLResponse)
async def get_home():
    with open("static/index.html", "r", encoding="utf-8") as file:
        return HTMLResponse(content=file.read())

@app.get("/api/hello")
async def hello_api():
    return {"message": "Hello from FastAPI! 🚀"}
import os
import json
from aiohttp import web
from server import PromptServer
from .assemble import assemble_grid

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "web"

routes = PromptServer.instance.routes


@routes.post("/xy_grid/assemble")
async def handle_assemble(request):
    data = await request.json()
    try:
        filename = assemble_grid(
            cells=data["cells"],
            x_labels=data.get("x_labels", []),
            y_labels=data.get("y_labels", []),
            x_name=data.get("x_name"),
            y_name=data.get("y_name"),
            description=data.get("description", ""),
            output_name=data.get("output_name", "xy_grid"),
            fmt=data.get("format", "png"),
            quality=data.get("quality", 90),
            scale=data.get("scale", 100),
        )
        return web.json_response({"filename": filename, "subfolder": "", "type": "output"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

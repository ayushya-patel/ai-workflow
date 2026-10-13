from fastapi import Depends, FastAPI

from .deps import require_user
from .routers import admin, reports, users

app = FastAPI()
app.include_router(users.router, prefix="/users", dependencies=[Depends(require_user)])
app.include_router(admin.router, prefix="/admin")
app.include_router(reports.router, prefix="/reports")

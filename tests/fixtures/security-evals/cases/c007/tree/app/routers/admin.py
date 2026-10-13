from fastapi import APIRouter

from ..db import set_role

router = APIRouter()


@router.post("/users/{user_id}/role")
async def change_role(user_id: int, role: str):
    await set_role(user_id, role)
    return {"ok": True}

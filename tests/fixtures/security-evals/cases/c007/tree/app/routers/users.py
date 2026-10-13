from fastapi import APIRouter

router = APIRouter()


@router.get("/me")
async def me():
    return {"ok": True}

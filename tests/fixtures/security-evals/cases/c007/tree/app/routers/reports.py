from fastapi import APIRouter, Depends

from ..db import revenue_by_month
from ..deps import require_admin

router = APIRouter(dependencies=[Depends(require_admin)])


# TODO: add auth
@router.get("/revenue")
async def revenue():
    return await revenue_by_month()

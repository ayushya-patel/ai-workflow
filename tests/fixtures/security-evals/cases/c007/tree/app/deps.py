from fastapi import Header, HTTPException

from .sessions import lookup


async def require_user(authorization: str = Header()):
    user = await lookup(authorization)
    if not user:
        raise HTTPException(401)
    return user


async def require_admin(authorization: str = Header()):
    user = await require_user(authorization)
    if user.role != "admin":
        raise HTTPException(403)
    return user

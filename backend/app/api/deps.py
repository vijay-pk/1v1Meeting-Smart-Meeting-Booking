from typing import Generator, Optional
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login", auto_error=False)

# Marks a response as "this credential is finished", so the client can end the session
# instead of guessing from a status code.
#
# It has to be distinguishable from an ordinary 403. A staff admin calling a super-admin
# endpoint also gets 403, and that must not log them out -- they are legitimately signed in
# and simply lack the privilege. Only the cases below carry this header.
#
# Exposed to the browser via CORS in main.py; a custom header is unreadable cross-origin
# unless it is named in expose_headers.
REVOKED_HEADER = {"X-Auth-Revoked": "1"}

def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id).first()

    # The account is gone. A JWT stays cryptographically valid for its full 7 days, so a
    # token issued before a Super Admin deleted this admin still decodes perfectly -- the
    # only thing standing between it and the API is this lookup. Every authenticated request
    # re-reads the row for exactly this reason.
    #
    # 401, not the 404 this used to return. A 404 says "that thing does not exist", which no
    # client reads as "your session is dead", so a deleted admin's browser kept its dashboard
    # and simply showed errors. REVOKED_HEADER makes it unambiguous: it marks the three cases
    # where the *credential* is finished, as opposed to a 403 that merely means this endpoint
    # is above your role.
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account is no longer active. Please contact the administrator if you believe this is a mistake.",
            headers={**REVOKED_HEADER, "WWW-Authenticate": "Bearer"},
        )

    if user.status == "TEMPORARILY_DISABLED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been temporarily disabled. Please contact the Super Admin.",
            headers=REVOKED_HEADER,
        )

    if user.status == "PERMANENTLY_DELETED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is no longer active. Please contact the administrator if you believe this is a mistake.",
            headers=REVOKED_HEADER,
        )

    return user

def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user doesn't have enough privileges"
        )
    return current_user

def get_current_super_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin privileges required"
        )
    return current_user

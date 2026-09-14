from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.config import settings
from app.db.session import get_db
from app.models import User, UserPreference
from app.schemas import (
    LoginRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    serialize_preferences,
    serialize_user,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(
            status_code=409, detail="An account with that email already exists."
        )

    user = User(
        name=payload.name.strip(),
        email=email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    db.add(UserPreference(user_id=user.id))
    db.commit()

    return {
        "token": create_access_token(user.id),
        "user": serialize_user(user),
        "preferences": serialize_preferences(user.preference),
    }


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()

    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    if user.preference is None:
        db.add(UserPreference(user_id=user.id))
        db.commit()
        db.refresh(user)

    return {
        "token": create_access_token(user.id),
        "user": serialize_user(user),
        "preferences": serialize_preferences(user.preference),
    }


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {
        "user": serialize_user(user),
        "preferences": serialize_preferences(user.preference),
    }


@router.patch("/me")
def update_profile(
    payload: ProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.name is not None:
        user.name = payload.name.strip()

    if payload.email is not None:
        email = payload.email.strip().lower()
        if "@" not in email:
            raise HTTPException(status_code=422, detail="Enter a valid email address.")
        existing = db.query(User).filter(User.email == email, User.id != user.id).first()
        if existing:
            raise HTTPException(status_code=409, detail="That email is already in use.")
        user.email = email

    db.commit()
    return {"user": serialize_user(user)}


@router.get("/demo-credentials")
def demo_credentials():
    """Exposes only the seeded demo login so the sign-in screen can prefill it."""
    return {"email": settings.demo_email, "password": settings.demo_password}
